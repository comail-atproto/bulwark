import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptSession } from '@/lib/auth/crypto';
import { GET, POST } from '@/app/api/contacts/[[...seg]]/route';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/groupware/access', () => ({ groupwareMailboxAllowed: vi.fn(async () => access.allowed) }));

const alice = 'did:plc:abcdefghijklmnopqrstuvwx';
const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const uid = 'urn:uuid:11111111-1111-4111-8111-111111111111';
const book = { actorDID: bob, addressBookId: 'personal', state: 'state-1', contacts: [{ id: uid, card: { '@type': 'Card', version: '1.0', uid } }] };

function request(method = 'GET', suffix = 'book', body?: string, slot = '1', origin = 'https://bulwark.test') {
  const cookie = [alice, bob].map((did, i) => `${i ? 'jmap_session_1' : 'jmap_session'}=${encryptSession('https://mail.test', i ? 'bob@example.test' : 'alice@example.test', 'synthetic', { did, groupwareEnabled: true })}`).join('; ');
  return new NextRequest(`https://bulwark.test/api/contacts/${suffix}?slot=${slot}`, { method, headers: { cookie, origin, host: 'bulwark.test', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body } : {}) });
}
const params = (seg = 'book') => ({ params: Promise.resolve({ seg: [seg] }) });

describe('personal contacts bridge', () => {
  beforeEach(() => {
    access.allowed = true;
    vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret'.repeat(3));
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'synthetic-bridge-secret'.repeat(3));
    vi.stubEnv('INBOX_CONTACTS_BRIDGE_URL', 'https://inbox.test/webmail/contacts/api/v1');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('starts consent for the selected account and accepts only the configured ticket origin', async () => {
    vi.stubEnv('INBOX_GROUPWARE_AUTHORIZATION_ORIGIN', 'https://spaces.test');
    const authorizationUrl = `https://spaces.test/oauth/contacts/tickets/${'A'.repeat(43)}`;
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => Response.json({ status: 'authorization_required', authorizationUrl }));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(request('POST', 'authorization', '{}'), params('authorization'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'authorization_required', authorizationUrl });
    expect(fetcher.mock.calls[0][0]).toBe('https://inbox.test/webmail/contacts/api/v1/authorization');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'authorization_required', authorizationUrl: authorizationUrl.replace('spaces.test', 'attacker.test') })));
    expect((await POST(request('POST', 'authorization', '{}'), params('authorization'))).status).toBe(502);
  });

  it('fails visibly when a configured private authority has no account target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_configured' }, { status: 404 })));
    const response = await GET(request(), params());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'provider_unavailable' });
  });

  it('uses the selected encrypted account and a contacts-only assertion', async () => {
    const fetcher = vi.fn(async () => Response.json(book));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(book);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://inbox.test/webmail/contacts/api/v1/book');
    expect(init.redirect).toBe('error');
    const token = new Headers(init.headers).get('authorization')!.slice(7);
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toMatchObject({ mailbox: 'bob@example.test', iss: 'comail-bulwark', aud: 'comail-contacts' });
  });

  it.each(['0', '2', '01'])('rejects a wrong or missing slot %s', async slot => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(book)));
    const response = await GET(request('GET', 'book', undefined, slot), params());
    expect(response.status).not.toBe(200);
  });

  it('checks the live entitlement before any contact provider request', async () => {
    access.allowed = false;
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await GET(request(), params())).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('distinguishes absent configuration from a failed configured authority', async () => {
    vi.stubEnv('INBOX_CONTACTS_BRIDGE_URL', '');
    expect(await (await GET(request(), params())).json()).toEqual({ error: 'not_configured' });
    vi.stubEnv('INBOX_CONTACTS_BRIDGE_URL', 'https://inbox.test/webmail/contacts/api/v1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private provider details'); }));
    const response = await GET(request(), params());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'provider_unavailable' });
  });

  it('leaves ordinary Stalwart sessions usable when private contacts are not configured', async () => {
    vi.stubEnv('INBOX_CONTACTS_BRIDGE_URL', '');
    const cookie = encryptSession('https://mail.test', 'legacy@example.test', 'synthetic');
    const req = new NextRequest('https://bulwark.test/api/contacts/book?slot=0', { headers: { cookie: `jmap_session=${cookie}` } });
    const response = await GET(req, params());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_configured' });
  });

  it.each([
    { ...book, actorDID: alice },
    { ...book, contacts: null },
    { ...book, contacts: [{ ...book.contacts[0], card: { ...book.contacts[0].card, uid: 'other' } }] },
    { ...book, contacts: [...book.contacts, ...book.contacts] },
    { ...book, contacts: [{ ...book.contacts[0], card: { ...book.contacts[0].card, media: {} } }] },
  ])('rejects substituted or incomplete source responses', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
    expect((await GET(request(), params())).status).toBe(502);
  });

  it('forwards exact apply bytes and returns independently verified state', async () => {
    const body = JSON.stringify({ requestId: 'synthetic-request-0001', baseState: 'state-0', operation: 'create', contactId: uid, card: book.contacts[0].card });
    const fetcher = vi.fn(async () => Response.json(book)); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('POST', 'apply', body), params('apply'))).status).toBe(200);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(body);
  });

  it('accepts the configured HTTPS browser origin behind an HTTP loopback proxy', async () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://inbox.test');
    const body = JSON.stringify({ requestId: 'synthetic-request-0001', baseState: 'state-0', operation: 'create', contactId: uid, card: book.contacts[0].card });
    const headers = new Headers(request('POST', 'apply', body).headers);
    headers.set('origin', 'https://inbox.test');
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-forwarded-host', 'inbox.test');
    const incoming = new NextRequest('http://127.0.0.1:3000/api/contacts/apply?slot=1', { method: 'POST', headers, body });
    const fetcher = vi.fn(async () => Response.json(book)); vi.stubGlobal('fetch', fetcher);
    expect((await POST(incoming, params('apply'))).status).toBe(200);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(body);
  });

  it('does not trust spoofed proxy headers to select another browser origin', async () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://inbox.test');
    const body = '{}';
    const headers = new Headers(request('POST', 'apply', body).headers);
    headers.set('origin', 'https://attacker.test');
    headers.set('host', 'attacker.test');
    headers.set('x-forwarded-host', 'attacker.test');
    headers.set('x-forwarded-proto', 'https');
    headers.set('sec-fetch-site', 'same-origin');
    const incoming = new NextRequest('http://127.0.0.1:3000/api/contacts/apply?slot=1', { method: 'POST', headers, body });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(incoming, params('apply'))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests and arbitrary paths without forwarding', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await GET(request('GET', 'book', undefined, '1', 'https://attacker.test'), params())).status).toBe(403);
    expect((await GET(request('GET', 'grant'), params('grant'))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an oversized apply body without contacting Inbox', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('POST', 'apply', JSON.stringify({ value: 'x'.repeat(128 * 1024) })), params('apply'))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.skipIf(process.env.COMAIL_BROWSER_TESTS !== '1')('keeps account selection and live denial in a real browser with HttpOnly sessions', async () => {
    const fetcher = vi.fn(async () => Response.json(book)); vi.stubGlobal('fetch', fetcher);
    const server = createServer(async (req, res) => {
      if (req.url === '/') { res.end('<!doctype html><title>Contact bridge fixture</title>'); return; }
      const url = `http://${req.headers.host}${req.url}`;
      const incoming = new NextRequest(url, { headers: req.headers as Record<string, string> });
      const response = await GET(incoming, params());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
      const context = await browser.newContext();
      await context.addCookies([alice, bob].map((did, i) => ({
        name: i ? 'jmap_session_1' : 'jmap_session',
        value: encryptSession('https://mail.test', i ? 'bob@example.test' : 'alice@example.test', 'synthetic', { did, groupwareEnabled: true }),
        url: base, httpOnly: true, sameSite: 'Lax' as const,
      })));
      const page = await context.newPage(); await page.goto(base);
      expect(await page.evaluate(() => document.cookie)).not.toContain('jmap_session');
      const selected = await page.evaluate(async () => {
        const response = await fetch('/api/contacts/book?slot=1');
        return { status: response.status, book: await response.json() };
      });
      expect(selected).toEqual({ status: 200, book });
      access.allowed = false;
      expect(await page.evaluate(async () => (await fetch('/api/contacts/book?slot=1')).status)).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await browser?.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);
});
