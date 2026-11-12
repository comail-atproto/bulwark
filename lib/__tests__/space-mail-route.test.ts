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
    method: 'POST', headers: { cookie, origin, host: 'bulwark.test', 'content-type': 'application/json' }, body,
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
