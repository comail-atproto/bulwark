import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptSession } from '@/lib/auth/crypto';
import { POST } from '@/app/api/mail/[[...seg]]/route';
import type { MailState } from '@/lib/space-mail/wire';

function createMailClient(slot: number) {
  async function send(operation: string, input: unknown) {
    const response = await fetch(`/api/mail/${operation}?slot=${slot}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
  }
  return {
    create: (input: unknown) => send('messages', input),
    replace: (input: unknown) => send('drafts', input),
    read: (state: MailState) => send('messages/read', { logicalMessageId: state.logicalMessageId, fingerprint: state.version }),
  };
}

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const hash = (letter: string) => `sha256-${letter.repeat(64)}`;
const state = (version = hash('b'), height = 1): MailState => ({
  logicalMessageId: hash('a'), snapshotId: hash('c'), version,
  mailboxIds: ['drafts'], keywords: ['$draft'], deletePending: false, tombstone: false,
  heads: [`state-${'d'.repeat(64)}`], headsDigest: hash('e'), stateDigest: hash('f'), height, revisionCount: height,
});
function request(operation: string, body: string, slot = '0', origin = 'https://bulwark.test') {
  const cookie = `jmap_session=${encryptSession('https://stalwart.test', 'alice@example.test', 'synthetic', { did })}`;
  return new NextRequest(`https://bulwark.test/api/mail/${operation}?slot=${slot}`, {
    method: 'POST', headers: { cookie, origin, host: 'bulwark.test', 'content-type': 'application/json', 'X-Comail-Mail-Protocol': '1' }, body,
  });
}
const params = (operation: string) => ({ params: Promise.resolve({ seg: operation.split('/') }) });

describe('private mail browser bridge', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret'.repeat(3));
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'synthetic-bridge-secret'.repeat(3));
    vi.stubEnv('INBOX_MAIL_BRIDGE_URL', 'https://inbox.test/webmail/mail/api/v1');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('refuses an old browser build before it contacts the PDS bridge', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ did, mailbox: 'alice@example.test', identities: ['alice@example.test'], capabilities: {
      messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false,
    } }));
    vi.stubGlobal('fetch', fetcher);
    for (const protocol of ['', '0']) {
      const req = request('bootstrap', '{}');
      if (protocol) req.headers.set('X-Comail-Mail-Protocol', protocol);
      else req.headers.delete('X-Comail-Mail-Protocol');
      const response = await POST(req, params('bootstrap'));
      expect(response.status).toBe(403);
      // Older browser builds display the error field directly.
      expect(await response.json()).toMatchObject({ error: 'Update Comail to access your PDS mailbox.', code: 'client_update_required' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns only a bootstrap bound to the signed mailbox and DID', async () => {
    const bootstrap = { did, mailbox: 'alice@example.test', identities: ['alice@example.test'], capabilities: {
      messageCreate: true, draftReplace: true, messageRead: true, inventory: true, submission: false,
    } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(bootstrap))
      .mockResolvedValueOnce(Response.json({ ...bootstrap, did: 'did:plc:other' })));
    expect((await POST(request('bootstrap', '{}'), params('bootstrap'))).status).toBe(200);
    expect((await POST(request('bootstrap', '{}'), params('bootstrap'))).status).toBe(502);
  });

  it('passes submission status and cancellation through the signed account bridge', async () => {
    const status = { id: 'submission-1', status: 'queued', logicalMessageId: hash('a'), fingerprint: hash('b'),
      sender: 'alice@example.test', recipients: [{ address: 'to@example.test', status: 'queued' }], notBefore: 0, dsnNotify: [] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json({ cancelled: true }));
    vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('submissions/status', JSON.stringify({ submissionId: 'submission-1' })), params('submissions/status'))).status).toBe(200);
    expect((await POST(request('submissions/cancel', JSON.stringify({ submissionId: 'submission-1' })), params('submissions/cancel'))).status).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://inbox.test/webmail/mail/api/v1/submissions/status', 'https://inbox.test/webmail/mail/api/v1/submissions/cancel',
    ]);
  });

  it('accepts only a valid submission inventory page', async () => {
    const entry = { id: 'submission-1', operationId: 'operation-1', status: 'queued', logicalMessageId: hash('a'), fingerprint: hash('b'),
      sender: 'alice@example.test', recipients: [{ address: 'to@example.test', status: 'queued' }], notBefore: 100, dsnNotify: ['FAILURE'] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ snapshotId: hash('c'), total: 1, entries: [entry] }))
      .mockResolvedValueOnce(Response.json({ snapshotId: hash('c'), total: 1, entries: [{ ...entry, operationId: '' }] })));
    expect((await POST(request('submissions/inventory', '{"limit":100}'), params('submissions/inventory'))).status).toBe(200);
    expect((await POST(request('submissions/inventory', '{"limit":100}'), params('submissions/inventory'))).status).toBe(502);
  });

  it('saves, edits and reopens exact draft bytes without contacting Stalwart', async () => {
    let raw = ''; let saved = state(); let writes = 0; let loseResponse = false;
    const operations = new Map<string, string>();
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('/api/mail/')) {
        const operation = url.split('?')[0].slice('/api/mail/'.length);
        return POST(request(operation, init.body as string), params(operation));
      }
      if (!url.startsWith('https://inbox.test/webmail/mail/api/v1/')) throw new Error('Stalwart unreachable');
      const token = new Headers(init.headers).get('authorization')!.slice(7);
      expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toMatchObject({ mailbox: 'alice@example.test', sub: did, aud: 'comail-mail' });
      expect(new Headers(init.headers).get('X-Comail-Mail-Protocol')).toBe('1');
      expect(init.cache).toBe('no-store'); expect(init.redirect).toBe('error');
      const input = JSON.parse(init.body as string);
      if (url.endsWith('/messages/read')) return Response.json({ snapshotId: saved.snapshotId, state: saved, folders: [], message: {
        uri: `at://did:plc:spaceauthority/space/email.atmos.mailbox/primary/${did}/email.atmos.message/message`, rkey: 'message', fingerprint: saved.version, logicalMessageId: saved.logicalMessageId,
        sourceKey: 'draft-1', sha256: 'a'.repeat(64), size: Buffer.from(raw, 'base64').length, raw,
      } });
      const key = input.mutation?.operationId ?? input.sourceKey;
      if (operations.has(key)) expect(operations.get(key)).toBe(init.body);
      else {
        operations.set(key, init.body as string); raw = input.raw; writes++;
        saved = state(writes === 1 ? hash('b') : hash('d'), writes);
      }
      if (loseResponse) { loseResponse = false; throw new Error('Lost response after commit'); }
      return Response.json(saved);
    });
    vi.stubGlobal('fetch', fetcher);
    const client = createMailClient(0);
    const original = Buffer.from('Subject: Synthetic\r\n\r\nFirst draft').toString('base64');
    const creation = { raw: original, sourceKey: 'draft-1', mailboxIds: ['drafts'], keywords: ['$draft'] };
    loseResponse = true;
    await expect(client.create(creation)).rejects.toThrow('mail_unavailable');
    const created = await client.create(creation);
    const mutation = {
      logicalMessageId: created.logicalMessageId, snapshotId: created.snapshotId, operationId: 'edit-1',
      expectedHeads: created.heads, expectedHeadsDigest: created.headsDigest, expectedStateDigest: created.stateDigest,
      expectedHeight: created.height, expectedRevisionCount: created.revisionCount,
      mailboxIds: created.mailboxIds, keywords: created.keywords, deletePending: false, tombstone: false,
    };
    const edited = Buffer.from('Subject: Synthetic\r\n\r\nEdited draft — exact bytes').toString('base64');
    const replacement = { raw: edited, sourceKey: 'draft-1', mutation };
    loseResponse = true;
    await expect(client.replace(replacement)).rejects.toThrow('mail_unavailable');
    const replaced = await client.replace(replacement);
    const reopened = await createMailClient(0).read(replaced);
    expect(reopened.message.raw).toBe(edited);
    expect(writes).toBe(2);
    expect(fetcher.mock.calls.every(([url]) => !url.includes('stalwart'))).toBe(true);
  });

  it('signs the exact selected account rather than browser-supplied actor data', async () => {
    const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
    const incoming = request('messages', JSON.stringify({ mailboxIds: ['drafts'], keywords: ['$draft'], did }));
    incoming.cookies.set('jmap_session_1', encryptSession('https://stalwart.test', 'bob@example.test', 'synthetic', { did: bob }));
    incoming.nextUrl.searchParams.set('slot', '1');
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const token = new Headers(init.headers).get('authorization')!.slice(7);
      expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toMatchObject({ mailbox: 'bob@example.test', sub: bob, aud: 'comail-mail' });
      return Response.json(state());
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await POST(incoming, params('messages'))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('proxies authenticated inventory and state operations without weakening account binding', async () => {
    const message = { uri: `at://did:plc:spaceauthority/space/email.atmos.mailbox/primary/${did}/email.atmos.message/message`, rkey: 'message', fingerprint: hash('b'), logicalMessageId: hash('a'), sha256: 'a'.repeat(64), size: 9 };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ snapshotId: hash('c'), folders: [], entries: [{ message, state: state() }], total: 1 }))
      .mockResolvedValueOnce(Response.json(state()));
    vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('inventory', '{"limit":100}'), params('inventory'))).status).toBe(200);
    expect((await POST(request('state', JSON.stringify({ logicalMessageId: hash('a'), version: hash('b'), mailboxIds: ['drafts'], keywords: ['$draft'], tombstone: false, deletePending: false })), params('state'))).status).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://inbox.test/webmail/mail/api/v1/inventory', 'https://inbox.test/webmail/mail/api/v1/state']);
  });

  it('rejects another origin, missing account slots and unexpected paths before storage access', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('messages', '{}', '0', 'https://attacker.test'), params('messages'))).status).toBe(403);
    expect((await POST(request('messages', '{}', '1'), params('messages'))).status).toBe(401);
    expect((await POST(request('messages', '{}', '00'), params('messages'))).status).toBe(400);
    expect((await POST(request('snapshot', '{}'), params('snapshot'))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps PDS failures and conflicts visible without trying another backend', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'mail_unavailable' }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ error: 'conflict' }, { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('messages', '{}'), params('messages'))).status).toBe(502);
    expect((await POST(request('drafts', '{}'), params('drafts'))).status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects selected content that differs from the requested version', async () => {
    const raw = Buffer.from('Synthetic').toString('base64');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ snapshotId: hash('c'), state: state(), folders: [], message: {
      uri: `at://did:plc:spaceauthority/space/email.atmos.mailbox/primary/${did}/email.atmos.message/message`, rkey: 'message', fingerprint: hash('b'), logicalMessageId: hash('a'),
      sha256: 'a'.repeat(64), size: 9, raw,
    } })));
    expect((await POST(request('messages/read', JSON.stringify({ logicalMessageId: hash('a'), fingerprint: hash('d') })), params('messages/read'))).status).toBe(502);
  });

  it('rejects saved state that differs from the requested placement or draft', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(state()));
    vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('messages', JSON.stringify({ mailboxIds: ['inbox'], keywords: ['$draft'] })), params('messages'))).status).toBe(502);
    expect((await POST(request('drafts', JSON.stringify({ mutation: { ...state(), logicalMessageId: hash('d') } })), params('drafts'))).status).toBe(502);
  });

  it('rejects malformed success responses and another DID in selected content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ saved: true }))
      .mockResolvedValueOnce(Response.json({ snapshotId: hash('c'), state: state(), folders: [], message: {
        uri: 'at://did:plc:spaceauthority/space/email.atmos.mailbox/primary/did:plc:other/email.atmos.message/message',
        rkey: 'message', fingerprint: hash('b'), logicalMessageId: hash('a'), sha256: 'a'.repeat(64), size: 9, raw: Buffer.from('Synthetic').toString('base64'),
      } })));
    expect((await POST(request('messages', '{}'), params('messages'))).status).toBe(502);
    expect((await POST(request('messages/read', '{}'), params('messages/read'))).status).toBe(502);
  });
});
