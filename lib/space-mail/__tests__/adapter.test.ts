import { describe, expect, it, vi } from 'vitest';
import { SpaceMailAdapter } from '../adapter';
import { buildMime } from '@/lib/mail-import/pst/mime';
import type { MailFolder, MailInventory, MailState } from '@/lib/space-mail/wire';

const state: MailState = { logicalMessageId: 'mail-1', snapshotId: 'snapshot-1', version: 'version-1', mailboxIds: ['inbox'], keywords: [], deletePending: false, tombstone: false, heads: ['head-1'], headsDigest: 'heads', stateDigest: 'state', height: 1, revisionCount: 1 };
const folder: MailFolder = { folderId: 'inbox', snapshotId: 'snapshot-1', name: 'Inbox', role: 'inbox', tombstone: false, heads: ['folder-head'], headsDigest: 'heads', stateDigest: 'state', height: 1, revisionCount: 1 };
const raw = buildMime({ from: { email: 'sender@example.test' }, to: [{ email: 'reader@example.test' }], cc: [], bcc: [], subject: 'Synthetic', text: 'Searchable body', attachments: [], date: new Date('2026-11-10T12:00:00Z') }, { boundarySeed: 'fixture' });
const encoded = Buffer.from(raw).toString('base64');
const inventory = (): MailInventory => ({ snapshotId: state.snapshotId, folders: [folder], entries: [{ state, message: { uri: 'synthetic', rkey: 'version-1', fingerprint: state.version, logicalMessageId: state.logicalMessageId, sourceKey: 'source-1', sha256: 'digest', size: raw.length } }], total: 1 });
const fixture = () => vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/mail/inventory?slot=0') return Response.json(inventory());
  if (url === '/api/mail/messages/read?slot=0') return Response.json({ snapshotId: state.snapshotId, state, folders: [folder], message: { ...inventory().entries[0].message, raw: encoded } });
  throw new Error(`Unexpected storage request: ${url} ${init?.method}`);
});

describe('PDS mail request adapter', () => {
  it('shows the controlled update message for an incompatible client', async () => {
    const fetcher = vi.fn(async () => Response.json({
      error: 'Update Comail to access your PDS mailbox.', code: 'client_update_required',
    }, { status: 403 }));
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    await expect(adapter.bootstrap()).rejects.toMatchObject({
      message: 'Update Comail to access your PDS mailbox.', code: 'client_update_required',
    });
  });

  it('answers the existing chained list/read/search calls without Stalwart', async () => {
    const fetcher = fixture();
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    const response = await adapter.request([
      ['Mailbox/get', { accountId: 'actor' }, 'folders'],
      ['Email/query', { accountId: 'actor', filter: { text: 'searchable' }, limit: 50 }, 'query'],
      ['Email/get', { accountId: 'actor', '#ids': { resultOf: 'query', name: 'Email/query', path: '/ids' } }, 'mail'],
      ['Thread/get', { accountId: 'actor', '#ids': { resultOf: 'mail', name: 'Email/get', path: '/list/*/threadId' } }, 'threads'],
    ]);
    expect(response.methodResponses[0][1]).toMatchObject({ list: [{ id: 'inbox', role: 'inbox', totalEmails: 1, unreadEmails: 1 }] });
    expect(response.methodResponses[1][1]).toMatchObject({ ids: ['mail-1'], total: 1 });
    expect(response.methodResponses[2][1]).toMatchObject({ list: [{ id: 'mail-1', subject: 'Synthetic', bodyValues: { text: { value: 'Searchable body' } } }] });
    expect(response.methodResponses[3][1]).toMatchObject({ list: [{ emailIds: ['mail-1'] }] });
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/mail/'))).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get('X-Comail-Mail-Protocol') === '1')).toBe(true);
  });

  it('lists the authenticated mailbox as the sender identity', async () => {
    const fetcher = fixture();
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    const response = await adapter.request([['Identity/get', { accountId: 'actor' }, 'sender']]);
    expect(response.methodResponses[0]).toEqual(['Identity/get', { accountId: 'actor', state: 'snapshot-1', list: [{ id: 'actor', name: 'reader@example.test', email: 'reader@example.test', mayDelete: false }], notFound: [] }, 'sender']);
  });

  it('keeps a submission update rejection distinct from an unknown delivery result', async () => {
    const calls: string[] = [];
    const backend = vi.fn(async (url: string) => {
      const operation = url.split('/api/mail/')[1].split('?')[0];
      calls.push(operation);
      if (operation === 'bootstrap') return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (operation === 'messages') return Response.json(state);
      return Response.json({ error: 'Update Comail to access your PDS mailbox.', code: 'client_update_required' }, { status: 403 });
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    await expect(adapter.sendRaw(new Blob([new Uint8Array(raw)]), { sender: 'reader@example.test', recipients: ['to@example.test'], sentMailboxId: 'sent' }))
      .rejects.toMatchObject({ message: 'Update Comail to access your PDS mailbox.', code: 'client_update_required' });
    expect(calls).toEqual(['bootstrap', 'messages', 'submissions']);
  });

  it('creates a folder in PDS using the observed inventory snapshot', async () => {
    const fetcher = fixture();
    const written: Record<string, unknown>[] = [];
    const backend = async (url: string, init?: RequestInit) => {
      if (url.includes('/folders?')) {
        written.push(JSON.parse(init!.body as string));
        return Response.json({ ...folder, folderId: 'child', name: 'Inbox/Child', role: undefined, snapshotId: 'snapshot-2' });
      }
      return fetcher(url, init);
    };
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    const response = await adapter.request([['Mailbox/set', { accountId: 'actor', create: { new: { name: 'Child', parentId: 'inbox' } } }, 'create']]);
    expect(written[0]).toMatchObject({ name: 'Inbox/Child', snapshotId: 'snapshot-1', expectedHeads: [], expectedHeight: 0, expectedRevisionCount: 0, expectedStateDigest: '', tombstone: false });
    expect(response.methodResponses[0][1]).toMatchObject({ created: { new: { id: 'child' } } });
  });

  it('creates a root folder when parentId is null', async () => {
    const backend = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/inventory?')) return Response.json(inventory());
      if (url.includes('/folders?')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ name: 'Projects', snapshotId: state.snapshotId });
        return Response.json({ ...folder, folderId: 'projects', name: 'Projects' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    const response = await adapter.request([['Mailbox/set', { accountId: 'actor', create: { root: { name: 'Projects', parentId: null } } }, 'set']]);
    expect(response.methodResponses[0][1].created).toEqual({ root: { id: 'projects' } });
  });

  it('returns each Email/set result after a middle conflict and pins later writes to the new snapshot', async () => {
    const entries = ['first', 'middle', 'gone', 'last'].map(id => ({ state: { ...state, logicalMessageId: id },
      message: { ...inventory().entries[0].message, logicalMessageId: id } }));
    let snapshotId = 'snapshot-1';
    const writes: Record<string, unknown>[] = [];
    const backend = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/inventory?')) return Response.json({ snapshotId, folders: [folder], entries, total: entries.length });
      if (url.includes('/state?')) {
        const input = JSON.parse(String(init?.body)); writes.push(input);
        if (input.logicalMessageId === 'middle') return Response.json({ error: 'conflict' }, { status: 409 });
        if (input.logicalMessageId === 'gone') return Response.json({ error: 'not_found' }, { status: 404 });
        expect(input.snapshotId).toBe(snapshotId);
        snapshotId = input.logicalMessageId === 'first' ? 'snapshot-2' : 'snapshot-3';
        return Response.json({ ...entries.find(entry => entry.state.logicalMessageId === input.logicalMessageId)!.state,
          ...input, snapshotId });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    const response = await adapter.request([['Email/set', { accountId: 'actor', update: { first: { 'keywords/$seen': true }, middle: { 'keywords/$seen': true }, gone: { 'keywords/$seen': true }, missing: { 'keywords/$seen': true } }, destroy: ['last', 'missing-delete'] }, 'set']]);
    expect(response.methodResponses[0][1]).toMatchObject({ oldState: 'snapshot-1', newState: 'snapshot-3',
      updated: { first: null }, notUpdated: { middle: { type: 'stateMismatch' }, gone: { type: 'notFound' }, missing: { type: 'notFound' } },
      destroyed: ['last'], notDestroyed: { 'missing-delete': { type: 'notFound' } } });
    expect(writes.map(write => write.snapshotId)).toEqual(['snapshot-1', 'snapshot-2', 'snapshot-2', 'snapshot-2']);
  });

  it('renames and deletes an empty custom folder using its observed revision', async () => {
    const custom = { ...folder, folderId: 'custom', name: 'Custom', role: undefined };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/inventory?')) return Response.json({ snapshotId: state.snapshotId, folders: [folder, custom], entries: [], total: 0 });
      const input = JSON.parse(init!.body as string);
      if (url.includes('/folders?')) return Response.json({ ...custom, name: input.tombstone ? 'Renamed' : input.name, tombstone: input.tombstone, snapshotId: 'snapshot-2' });
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    const renamed = await adapter.request([['Mailbox/set', { accountId: 'actor', update: { custom: { name: 'Renamed' } } }, 'rename']]);
    expect(renamed.methodResponses[0][1]).toMatchObject({ updated: { custom: null } });
    expect(JSON.parse(fetcher.mock.calls.find(([url]) => url.includes('/folders?'))![1]!.body as string)).toMatchObject({ folderId: 'custom', name: 'Renamed', expectedHeads: custom.heads, expectedHeadsDigest: custom.headsDigest, expectedStateDigest: custom.stateDigest });
    const deleted = await adapter.request([['Mailbox/set', { accountId: 'actor', destroy: ['custom'] }, 'delete']]);
    expect(deleted.methodResponses[0][1]).toMatchObject({ destroyed: ['custom'] });
  });

  it('retries an identical failed mutation with the original observed state', async () => {
    const fetcher = fixture(); let writes = 0; const bodies: string[] = [];
    const backend = async (url: string, init?: RequestInit) => {
      if (url.includes('/state?')) {
        bodies.push(init!.body as string);
        if (++writes === 1) throw new Error('Lost response');
        return Response.json({ ...state, keywords: ['$seen'], snapshotId: 'snapshot-2', height: 2, revisionCount: 2 });
      }
      return fetcher(url, init);
    };
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    const calls: [string, Record<string, unknown>, string][] = [['Email/set', { accountId: 'actor', update: { 'mail-1': { 'keywords/$seen': true } } }, 'change']];
    await expect(adapter.request(calls)).rejects.toThrow('Lost response');
    await adapter.request(calls);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0])).toMatchObject({ logicalMessageId: 'mail-1', snapshotId: 'snapshot-1', expectedHeight: 1, keywords: ['$seen'] });
  });

  it('saves and replaces draft MIME with exact retry bytes and retained attachments', async () => {
    const bodies: string[] = []; let failed = false;
    const fetcher = fixture();
    const backend = async (url: string, init?: RequestInit) => {
      if (url.includes('/drafts?')) {
        bodies.push(init!.body as string);
        if (!failed) { failed = true; throw new Error('PDS unavailable'); }
        return Response.json({ ...state, version: 'version-2', height: 2, revisionCount: 2 });
      }
      return fetcher(url, init);
    };
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    const upload = await adapter.upload(new Blob([new Uint8Array([0, 255, 42])], { type: 'application/octet-stream' }));
    const draft = { from: [{ email: 'reader@example.test' }], to: [{ email: 'recipient@example.test' }], subject: 'Edited draft',
      bodyValues: { text: { value: 'Latest draft body' } }, textBody: [{ partId: 'text' }], attachments: [{ ...upload, name: 'binary.bin' }],
      mailboxIds: { inbox: true }, keywords: { $draft: true, $seen: true } };
    await expect(adapter.saveDraft(draft, 'mail-1')).rejects.toThrow('PDS unavailable');
    expect(await adapter.saveDraft(draft, 'mail-1')).toBe('mail-1');
    expect(bodies[0]).toBe(bodies[1]);
    const input = JSON.parse(bodies[1]);
    expect(input.mutation).toMatchObject({ logicalMessageId: 'mail-1', expectedHeight: 1 });
    expect(input.mutation.version).toBeUndefined();
    const mime = await import('postal-mime');
    const parsed = await mime.default.parse(Buffer.from(input.raw, 'base64'));
    expect(parsed.text).toBe('Latest draft body');
    expect(Array.from(new Uint8Array(parsed.attachments[0].content as ArrayBuffer))).toEqual([0, 255, 42]);
  });

  it('fails closed on a changed account or unsupported search condition', async () => {
    let slot = 0; const fetcher = fixture();
    const adapter = new SpaceMailAdapter(() => slot, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    await expect(adapter.request([['Email/query', { filter: { unsupported: true } }, 'q']])).rejects.toThrow('unsupported_filter');
    slot = 1;
    await expect(adapter.request([['Mailbox/get', {}, 'q']])).rejects.toThrow('account_changed');
  });

  it('retries a lost submission response with the same operation and Sent message', async () => {
    let creates = 0; let submits = 0; const requests: string[] = [];
    const backend = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/bootstrap?')) return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (url.includes('/messages?')) { creates++; return Response.json({ ...state, logicalMessageId: 'sent-1', version: 'fingerprint-1', mailboxIds: ['sent'], keywords: ['$seen'] }); }
      if (url.includes('/submissions/status?')) return Response.json({ error: 'not_found' }, { status: 404 });
      if (url.includes('/submissions?')) {
        requests.push(init!.body as string);
        if (++submits === 1) throw new Error('Lost response');
        return Response.json({ id: 'submission-1', status: 'queued', recipients: [{ address: 'to@example.test', status: 'queued' }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    const data = { from: [{ email: 'reader@example.test' }], to: [{ email: 'to@example.test' }], subject: 'Retry', bodyValues: { text: { value: 'Body' } }, textBody: [{ partId: 'text' }] };
    const options = { sender: 'reader@example.test', recipients: ['to@example.test'], sentMailboxId: 'sent' };
    await expect(adapter.sendComposed(data, options)).rejects.toThrow('delivery has not started');
    const result = await adapter.sendComposed(data, options);
    expect(result.submission.id).toBe('submission-1');
    expect(creates).toBe(1);
    expect(requests[1]).toBe(requests[0]);
  });

  it('does not claim submit permission when durable submission is unavailable', async () => {
    const fetcher = fixture();
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    const response = await adapter.request([['Mailbox/get', {}, 'folders']]);
    expect((response.methodResponses[0][1].list as Array<{ myRights: { maySubmit: boolean } }>)[0].myRights.maySubmit).toBe(false);
  });

  it('keeps existing scheduled mail readable and cancellable during a send outage', async () => {
    const sentState = { ...state, mailboxIds: ['sent'] };
    const status = { id: 'submission-1', operationId: 'operation-1', status: 'queued', logicalMessageId: state.logicalMessageId,
      fingerprint: state.version, sender: 'reader@example.test', recipients: [{ address: 'to@example.test', status: 'queued' }],
      dsnNotify: ['FAILURE'], notBefore: Math.ceil(Date.now() / 1000) + 3600 };
    const calls: string[] = [];
    const backend = vi.fn(async (url: string) => {
      const operation = url.split('/api/mail/')[1].split('?')[0]; calls.push(operation);
      if (operation === 'bootstrap') return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'],
        capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false, nativeSubmission: false } });
      if (operation === 'inventory') return Response.json({ snapshotId: state.snapshotId, folders: [{ ...folder, folderId: 'sent', role: 'sent' }],
        entries: [{ state: sentState, message: inventory().entries[0].message }], total: 1 });
      if (operation === 'submissions/inventory') return Response.json({ snapshotId: state.snapshotId, entries: [status], total: 1 });
      if (operation === 'submissions/status') return Response.json(status);
      if (operation === 'submissions/cancel') return Response.json({ cancelled: true });
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    expect(adapter.canSubmit).toBe(false);
    expect((await adapter.scheduledSubmissions()).map(item => item.id)).toEqual(['submission-1']);
    expect((await adapter.submissionStatus('submission-1')).recipients).toEqual(status.recipients);
    await adapter.cancelSubmission('submission-1');
    await expect(adapter.rescheduleSubmission('submission-1', status.notBefore + 60)).rejects.toThrow('Mail submission is unavailable');
    expect(calls).not.toContain('submissions');
  });

  it('rejects a response decoded after the active account changes', async () => {
    let slot = 0;
    let release!: (value: unknown) => void;
    const decoding = new Promise<unknown>(resolve => { release = resolve; });
    const fetcher = vi.fn(async () => ({ ok: true, json: () => decoding }) as Response);
    const adapter = new SpaceMailAdapter(() => slot, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    const pending = adapter.post('bootstrap', {});
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    slot = 1;
    release({ did: 'did:plc:abcdefghijklmnopqrstuvwx' });
    await expect(pending).rejects.toThrow('account_changed');
  });

  it('rejects an unsupported Email/set create before applying a valid update', async () => {
    const fetcher = fixture();
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    await expect(adapter.request([['Email/set', { update: { 'mail-1': { 'keywords/$seen': true } }, create: { other: {} } }, 'set']])).rejects.toThrow('unsupported_email_create');
    expect(fetcher.mock.calls.some(([url]) => url.includes('/state?'))).toBe(false);
  });

  it('rejects a folder set that changes during inventory pagination', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (!url.includes('/inventory?')) throw new Error(`Unexpected request: ${url}`);
      calls++;
      return Response.json({ snapshotId: 'snapshot-1', folders: calls === 1 ? [folder] : [], entries: [], total: 0,
        ...(calls === 1 ? { nextAfter: 'cursor-1' } : {}) });
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, fetcher);
    await expect(adapter.request([['Mailbox/get', {}, 'folders']])).rejects.toThrow('conflict');
  });

  it('shows only verified unsubmitted Sent copies after a restart', async () => {
    const sentState = { ...state, mailboxIds: ['sent'] };
    const sentInventory = { snapshotId: state.snapshotId, folders: [{ ...folder, folderId: 'sent', role: 'sent', name: 'Sent' }],
      entries: [{ state: sentState, message: { ...inventory().entries[0].message, sourceKey: 'webmail-send:operation-1' } }], total: 1 };
    let unknown = false;
    const backend = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (url.includes('/inventory?')) return Response.json(sentInventory);
      if (url.includes('/submissions/status?')) return Response.json({ error: unknown ? 'mail_unavailable' : 'not_found' }, { status: unknown ? 503 : 404 });
      if (url.includes('/messages/read?')) return Response.json({ snapshotId: state.snapshotId, state: sentState, folders: [], message: { ...sentInventory.entries[0].message, raw: encoded } });
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    expect((await adapter.unsubmittedSentCopies()).map(email => email.id)).toEqual(['mail-1']);
    unknown = true;
    await expect(adapter.unsubmittedSentCopies()).rejects.toThrow('mail_unavailable');
  });

  it('reschedules after confirmed cancellation and keeps the original envelope and DSN', async () => {
    const calls: string[] = []; let canceled = false;
    const backend = vi.fn(async (url: string, init?: RequestInit) => {
      const operation = url.split('/api/mail/')[1].split('?')[0]; calls.push(operation);
      if (operation === 'bootstrap') return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true, maxDelayedSendSeconds: 2592000 } });
      if (operation === 'inventory') return Response.json({ ...inventory(), folders: [{ ...folder, folderId: 'sent', role: 'sent' }],
        entries: [{ ...inventory().entries[0], state: { ...state, mailboxIds: ['sent'] } }] });
      if (operation === 'messages/read') return Response.json({ snapshotId: state.snapshotId, state: { ...state, mailboxIds: ['sent'] },
        folders: [], message: { ...inventory().entries[0].message, raw: encoded } });
      if (operation === 'submissions/status') return Response.json({ id: 'old', status: canceled ? 'cancelled' : 'partial', logicalMessageId: 'mail-1', fingerprint: 'version-1', sender: 'reader@example.test',
        recipients: [{ address: 'to@example.test', status: canceled ? 'canceled' : 'queued' }, { address: 'hidden@example.test', status: canceled ? 'canceled' : 'retry' },
          { address: 'already@example.test', status: 'accepted' }, { address: 'uncertain@example.test', status: 'ambiguous' }], dsnNotify: ['SUCCESS', 'FAILURE', 'DELAY'], notBefore: 100 });
      if (operation === 'submissions/cancel') { canceled = true; return Response.json({ cancelled: true }); }
      if (operation === 'submissions') {
        const input = JSON.parse(init!.body as string);
        expect(input).toMatchObject({ logicalMessageId: 'mail-1', fingerprint: 'version-1', sender: 'reader@example.test', recipients: ['to@example.test', 'hidden@example.test'], dsnNotify: ['SUCCESS', 'FAILURE', 'DELAY'], notBefore: 200 });
        return Response.json({ id: 'new', status: 'queued', ...input, recipients: input.recipients.map((address: string) => ({ address, status: 'queued' })) });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    expect((await adapter.rescheduleSubmission('old', 200)).id).toBe('new');
    expect(calls).toEqual(['bootstrap', 'submissions/status', 'inventory', 'messages/read', 'submissions/cancel', 'submissions/status', 'submissions']);
  });

  it('keeps partial recipient outcomes in the scheduled list', async () => {
    const sentState = { ...state, mailboxIds: ['sent'] };
    const sentFolder = { ...folder, folderId: 'sent', role: 'sent', name: 'Sent' };
    const outcomes = [{ address: 'waiting@example.test', status: 'retry' }, { address: 'done@example.test', status: 'accepted' }];
    const backend = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true, maxDelayedSendSeconds: 2592000 } });
      if (url.includes('/submissions/inventory?')) return Response.json({ snapshotId: state.snapshotId, entries: [{ id: 'submission-1', operationId: 'operation-1', status: 'partial', logicalMessageId: state.logicalMessageId,
        fingerprint: state.version, sender: 'reader@example.test', recipients: outcomes, dsnNotify: [], notBefore: Math.ceil(Date.now() / 1000) + 3600 }], total: 1 });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: state.snapshotId, folders: [sentFolder], entries: [{ state: sentState,
        message: { ...inventory().entries[0].message, sourceKey: 'webmail-send:operation-1' } }], total: 1 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    expect((await adapter.scheduledSubmissions())[0].recipients).toEqual(outcomes);
  });

  it('keeps a pending intent visible when its Sent message is missing', async () => {
    const now = Math.ceil(Date.now() / 1000) + 3600;
    const statuses = ['missing', 'mail-1'].map((id, index) => ({ id: `submission-${index}`, operationId: `operation-${index}`,
      status: 'queued', logicalMessageId: id, fingerprint: state.version, sender: 'reader@example.test',
      recipients: [{ address: 'to@example.test', status: 'queued' }], dsnNotify: [], notBefore: now }));
    const backend = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'],
        capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (url.includes('/submissions/inventory?')) return Response.json({ snapshotId: state.snapshotId, entries: statuses, total: 2 });
      if (url.includes('/submissions/status?')) return Response.json(statuses[0]);
      if (url.includes('/inventory?')) return Response.json({ ...inventory(), folders: [{ ...folder, folderId: 'sent', role: 'sent' }],
        entries: [{ ...inventory().entries[0], state: { ...state, mailboxIds: ['sent'] } }] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    expect((await adapter.scheduledSubmissions()).map(item => item.id)).toEqual(['submission-0', 'submission-1']);
    await expect(adapter.rescheduleSubmission('submission-0', now + 60)).rejects.toThrow('Sent message is unavailable');
    expect(backend.mock.calls.some(([url]) => url.includes('/submissions/cancel?'))).toBe(false);
  });

  it('restores a replacement schedule from submission inventory after reload', async () => {
    const sentState = { ...state, mailboxIds: ['sent'] };
    const sentFolder = { ...folder, folderId: 'sent', role: 'sent', name: 'Sent' };
    const replacement = { id: 'replacement', operationId: 'reschedule:original:200', status: 'queued',
      logicalMessageId: state.logicalMessageId, fingerprint: state.version, sender: 'reader@example.test',
      recipients: [{ address: 'waiting@example.test', status: 'queued' }], dsnNotify: ['FAILURE'],
      notBefore: Math.ceil(Date.now() / 1000) + 3600 };
    const backend = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true, maxDelayedSendSeconds: 2592000 } });
      if (url.includes('/submissions/inventory?')) return Response.json({ snapshotId: state.snapshotId, entries: [replacement], total: 1 });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: state.snapshotId, folders: [sentFolder], entries: [{ state: sentState,
        message: { ...inventory().entries[0].message, sourceKey: 'webmail-send:original' } }], total: 1 });
      if (url.includes('/submissions/status?')) return Response.json({ id: 'original', status: 'canceled',
        logicalMessageId: state.logicalMessageId, fingerprint: state.version, sender: 'reader@example.test',
        recipients: [{ address: 'waiting@example.test', status: 'canceled' }], dsnNotify: ['FAILURE'], notBefore: 100 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new SpaceMailAdapter(() => 0, { accountId: 'actor', did: 'did:plc:abcdefghijklmnopqrstuvwx', username: 'reader@example.test' }, backend);
    await adapter.bootstrap();
    expect((await adapter.scheduledSubmissions()).map(item => item.id)).toEqual(['replacement']);
  });
});
