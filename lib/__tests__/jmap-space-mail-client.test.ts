import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { useAccountStore } from '@/stores/account-store';
import { type OfflineResponse, setOfflineHooks } from '@/lib/jmap/offline-hooks';

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const folder = { folderId: 'drafts', snapshotId: 'snapshot', name: 'Drafts', role: 'drafts', tombstone: false, heads: ['head'], headsDigest: 'heads', stateDigest: 'state', height: 1, revisionCount: 1 };
afterEach(() => { setOfflineHooks(null); vi.unstubAllGlobals(); useAccountStore.setState({ accounts: [] }); });

describe('existing mail client with PDS storage', () => {
  it('connects and saves through the private adapter without Stalwart mail calls', async () => {
    const record = vi.fn();
    setOfflineHooks({ skipNetwork: () => false, answer: vi.fn(), record, noteNetwork: vi.fn(), serverGone: vi.fn(), blob: vi.fn(), recordBlob: vi.fn(), holdUpload: vi.fn() });
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/mail/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false, submissionReauthorizationRequired: true } });
      if (url.startsWith('/api/mail/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [folder], entries: [], total: 0 });
      if (url.startsWith('/api/mail/messages?')) return Response.json({ logicalMessageId: 'draft-1', version: 'version-1', snapshotId: 'new', mailboxIds: ['drafts'], keywords: ['$draft', '$seen'] });
      throw new Error(`Stalwart unreachable: ${url} ${init?.method}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    expect(client.isPDSMail()).toBe(true);
    expect(client.needsPrivateMailReauthorization()).toBe(true);
    expect((await client.getMailboxes())[0].role).toBe('drafts');
    expect(await client.createDraft(['recipient@example.test'], 'Synthetic', 'Draft bytes')).toBe('draft-1');
    expect(record.mock.calls.some(([, calls]) => calls.some(([name]: [string]) => name === 'Mailbox/get'))).toBe(true);
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/mail/'))).toBe(true);
    expect(JSON.parse(fetcher.mock.calls.find(([url]) => url.startsWith('/api/mail/messages?'))![1]!.body as string).keywords).toContain('$draft');
    client.disconnect();
  });

  it('uses opted-in device cache for PDS reads and keeps exact actor checks before cache access', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    let offline = false;
    const answer = vi.fn<() => Promise<OfflineResponse>>(async () => ({ methodResponses: [['Email/get', { list: [{ id: 'cached-mail', subject: 'Device copy', bodyValues: { text: { value: 'Cached synthetic body' } } }] }, '0']] }));
    const record = vi.fn();
    setOfflineHooks({ skipNetwork: () => offline, answer, record, noteNetwork: vi.fn(), serverGone: vi.fn(), blob: vi.fn(), recordBlob: vi.fn(), holdUpload: vi.fn() });
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false } });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [folder], entries: [], total: 0 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    await client.getMailboxes();
    expect(record).toHaveBeenCalled();
    const calls = fetcher.mock.calls.length;
    offline = true;
    expect(await client.getEmail('cached-mail')).toMatchObject({ subject: 'Device copy', bodyValues: { text: { value: 'Cached synthetic body' } } });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(answer).toHaveBeenCalledTimes(1);
    let release!: (value: OfflineResponse) => void;
    answer.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delayedRead = client.getEmail('cached-mail');
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
    useAccountStore.getState().updateAccount(id, { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' });
    release({ methodResponses: [['Email/get', { list: [{ id: 'cached-mail', subject: 'Old account copy', bodyValues: {} }] }, '0']] });
    await expect(delayedRead).resolves.toBeNull();
    await expect(client.getMailboxes()).rejects.toThrow('account_changed');
    expect(answer).toHaveBeenCalledTimes(2);
    client.disconnect();
  });

  it('keeps opted-in PDS attachment copies on the device without a second mail server', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const deviceBlob = new Blob(['Device attachment'], { type: 'text/plain' });
    let offline = false;
    const recordBlob = vi.fn(); const cachedBlob = vi.fn(async () => deviceBlob);
    setOfflineHooks({ skipNetwork: () => offline, answer: vi.fn(), record: vi.fn(), noteNetwork: vi.fn(), serverGone: vi.fn(), blob: cachedBlob, recordBlob, holdUpload: vi.fn() });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, vi.fn());
    const adapter = (client as unknown as { spaceMailAdapter: { blob(id: string): Promise<Blob> } }).spaceMailAdapter;
    const download = vi.spyOn(adapter, 'blob').mockResolvedValue(deviceBlob);
    expect(await (await client.fetchBlob('space-mail:message:version:attachment-0')).text()).toBe('Device attachment');
    expect(recordBlob).toHaveBeenCalledWith(client, 'space-mail:message:version:attachment-0', did, deviceBlob);
    offline = true;
    expect(await (await client.fetchBlob('space-mail:message:version:attachment-0')).text()).toBe('Device attachment');
    expect(download).toHaveBeenCalledTimes(1);
    expect(cachedBlob).toHaveBeenCalledWith(client, 'space-mail:message:version:attachment-0', did);
  });

  it('polls mailbox state through the PDS adapter rather than a legacy JMAP URL', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const legacy = vi.fn().mockRejectedValue(new Error('Unexpected legacy JMAP poll'));
    vi.stubGlobal('fetch', legacy);
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false } });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [folder], entries: [], total: 0 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    const poll = client as unknown as { fetchPolledStateResponses(): Promise<[string, { state: string }, string][]> };
    const states = await poll.fetchPolledStateResponses();
    expect(states.map(([name, value]) => [name, value.state])).toEqual([['Mailbox/get', 'snapshot'], ['Email/get', 'snapshot']]);
    expect(legacy).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('leaves native PDS journal retention to the backend instead of pruning JMAP submissions', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [folder], entries: [], total: 0 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    const calls = fetcher.mock.calls.length;
    expect(await client.pruneEmailSubmissions({ force: true })).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    client.disconnect();
  });

  it('refuses private mail when bootstrap does not confirm its account', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const fetcher = vi.fn(async () => Response.json({ did: 'did:plc:wrong', mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false } }));
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await expect(client.connect()).rejects.toThrow('mail_unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sends from the composer through PDS and preserves Bcc only in the saved copy', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const sent = { ...folder, folderId: 'sent', name: 'Sent', role: 'sent' };
    let saved: Record<string, unknown> | undefined;
    let submitted: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const input = JSON.parse(init?.body as string);
      if (url.startsWith('/api/mail/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (url.startsWith('/api/mail/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [folder, sent], entries: [], total: 0 });
      if (url.startsWith('/api/mail/messages?')) {
        saved = input;
        return Response.json({ logicalMessageId: 'message-1', version: 'fingerprint-1', snapshotId: 'new', mailboxIds: ['sent'], keywords: ['$seen'] });
      }
      if (url.startsWith('/api/mail/submissions?')) {
        submitted = input;
        return Response.json({ id: 'submission-1', status: 'queued', recipients: input.recipients.map((address: string) => ({ address, status: 'queued' })) });
      }
      throw new Error(`Stalwart unreachable: ${url}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    const result = await client.sendEmail(['to@example.test'], 'Private', 'Body', [], ['hidden@example.test']);
    expect(result).toMatchObject({ emailId: 'message-1', emailSubmissionId: 'submission-1', scheduled: false });
    expect(saved).toMatchObject({ mailboxIds: ['sent'], keywords: ['$seen'] });
    expect(Buffer.from(saved!.raw as string, 'base64').toString()).toContain('Bcc: <hidden@example.test>');
    expect(submitted).toMatchObject({ logicalMessageId: 'message-1', fingerprint: 'fingerprint-1', sender: 'reader@example.test', recipients: ['to@example.test', 'hidden@example.test'] });
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/mail/'))).toBe(true);
  });

  it('reports an uncertain raw send instead of ordinary success', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const sent = { ...folder, folderId: 'sent', name: 'Sent', role: 'sent' };
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: true, nativeSubmission: true } });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [sent], entries: [], total: 0 });
      if (url.includes('/messages?')) return Response.json({ logicalMessageId: 'raw-1', version: 'fingerprint-1', snapshotId: 'new', mailboxIds: ['sent'], keywords: ['$seen'] });
      if (url.includes('/submissions?')) return Response.json({ id: 'submission-1', status: 'ambiguous', recipients: [{ address: 'to@example.test', status: 'ambiguous' }] });
      throw new Error(`Unexpected route: ${url}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    const result = await client.sendRawEmail(new Blob(['From: reader@example.test\r\nTo: to@example.test\r\nSubject: Raw\r\n\r\nBody']), did, 'sent');
    expect(result).toMatchObject({ privateSubmissionStatus: 'ambiguous', privateRecipientOutcomes: [{ address: 'to@example.test', status: 'ambiguous' }] });
  });

  it('shows and can cancel an intent whose Sent copy is missing', async () => {
    const id = useAccountStore.getState().addAccount({ username: 'reader@example.test', serverUrl: 'https://stalwart.test', did, label: 'Synthetic', displayName: 'Synthetic', email: 'reader@example.test', authMode: 'basic', rememberMe: false, lastLoginAt: Date.now(), isConnected: false, hasError: false, isDefault: true });
    const account = useAccountStore.getState().getAccountById(id)!;
    const notBefore = Math.ceil(Date.now() / 1000) + 3600;
    const entries = ['missing', 'present'].map((logicalMessageId, index) => ({ id: `submission-${index}`, operationId: `operation-${index}`,
      status: index === 0 ? 'ambiguous' : 'queued', logicalMessageId, fingerprint: 'version-1', sender: 'reader@example.test',
      recipients: [{ address: 'to@example.test', status: index === 0 ? 'ambiguous' : 'queued' }], dsnNotify: [], notBefore: index === 0 ? 0 : notBefore }));
    const state = { logicalMessageId: 'present', version: 'version-1', snapshotId: 'snapshot', mailboxIds: ['sent'], keywords: [],
      deletePending: false, tombstone: false, heads: ['head'], headsDigest: 'heads', stateDigest: 'state', height: 1, revisionCount: 1 };
    const raw = Buffer.from('From: reader@example.test\r\nTo: to@example.test\r\nSubject: Present\r\n\r\nBody');
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap?')) return Response.json({ did, mailbox: 'reader@example.test', identities: ['reader@example.test'], capabilities: { messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false } });
      if (url.includes('/submissions/inventory?')) return Response.json({ snapshotId: 'snapshot', entries, total: 2 });
      if (url.includes('/submissions/cancel?')) return Response.json({ cancelled: true });
      if (url.includes('/inventory?')) return Response.json({ snapshotId: 'snapshot', folders: [{ ...folder, role: 'sent', folderId: 'sent' }],
        entries: [{ state, message: { uri: 'synthetic', rkey: 'present', fingerprint: 'version-1', logicalMessageId: 'present', sha256: 'a'.repeat(64), size: raw.length } }], total: 1 });
      if (url.includes('/messages/read?')) return Response.json({ snapshotId: 'snapshot', state, folders: [],
        message: { uri: 'synthetic', rkey: 'present', fingerprint: 'version-1', logicalMessageId: 'present', sha256: 'a'.repeat(64), size: raw.length, raw: raw.toString('base64') } });
      throw new Error(`Unexpected route: ${url}`);
    });
    const client = new JMAPClient('https://stalwart.test', 'reader@example.test', '');
    client.configurePrivateMail(account.cookieSlot, { accountId: did, did, username: 'reader@example.test' }, fetcher);
    await client.connect();
    const scheduled = await client.getScheduledEmails();
    expect(scheduled.emails.map(email => email.subject)).toEqual(['Message unavailable', 'Present']);
    expect(scheduled.emails[0].privateSendPending).toBe(true);
    expect(scheduled.emails[0].privateSendUncertain).toBe(true);
    await client.cancelEmailSubmission('submission-0');
    expect(fetcher.mock.calls.some(([url]) => url.includes('/submissions/cancel?'))).toBe(true);
  });
});
