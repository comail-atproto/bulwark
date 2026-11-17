import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptSession } from '@/lib/auth/crypto';
import { GET, POST } from '@/app/api/files/[[...seg]]/route';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/groupware/access', () => ({ groupwareMailboxAllowed: vi.fn(async () => access.allowed) }));
const alice = 'did:plc:abcdefghijklmnopqrstuvwx';
const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
function request(method = 'GET', route = 'inventory', body?: string, slot = '1', origin = 'https://bulwark.test') {
  const cookie = [alice, bob].map((did, index) => `${index ? 'jmap_session_1' : 'jmap_session'}=${encryptSession('https://mail.test', index ? 'bob@example.test' : 'alice@example.test', 'synthetic', { did, groupwareEnabled: true })}`).join('; ');
  return new NextRequest(`https://bulwark.test/api/files/${route}?slot=${slot}`, { method, headers: { cookie, origin, host: 'bulwark.test', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body } : {}) });
}
const params = (route = 'inventory') => ({ params: Promise.resolve({ seg: [route] }) });

describe('private file browser bridge', () => {
  beforeEach(() => {
    access.allowed = true;
    vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret'.repeat(3));
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'synthetic-bridge-secret'.repeat(3));
    vi.stubEnv('INBOX_FILES_BRIDGE_URL', 'https://inbox.test/webmail/files/api/v1');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('binds file access to the selected encrypted account and separate audience', async () => {
    const fetcher = vi.fn(async () => Response.json({ actorDID: bob, files: [] }));
    vi.stubGlobal('fetch', fetcher);
    expect((await GET(request(), params())).status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://inbox.test/webmail/files/api/v1/inventory');
    expect(init.redirect).toBe('error');
    const token = new Headers(init.headers).get('authorization')!.slice(7);
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toMatchObject({ mailbox: 'bob@example.test', aud: 'comail-files' });
    expect((await GET(request('GET', 'inventory', undefined, '0'), params())).status).toBe(502);
  });

  it('checks current access and same origin before contacting private storage', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    access.allowed = false;
    expect((await GET(request(), params())).status).toBe(403);
    access.allowed = true;
    expect((await GET(request('GET', 'inventory', undefined, '1', 'https://attacker.test'), params())).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires exact authorization tickets from the configured origin', async () => {
    const authorizationUrl = `https://inbox.comail.at/oauth/files/tickets/${'A'.repeat(43)}`;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'authorization_required', authorizationUrl })));
    const response = await POST(request('POST', 'authorization', '{}'), params('authorization'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'authorization_required', authorizationUrl });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'authorization_required', authorizationUrl: authorizationUrl.replace('inbox.comail.at', 'attacker.test') })));
    expect((await POST(request('POST', 'authorization', '{}'), params('authorization'))).status).toBe(502);
  });

  it('serves verified private downloads only as inert attachments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic private bytes', { headers: { 'Content-Type': 'application/octet-stream' } })));
    const response = await POST(request('POST', 'download', '{"fileId":"file-test","revisionId":"revision-test"}'), params('download'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('synthetic private bytes');
  });

  it('accepts the configured HTTPS browser origin behind an HTTP loopback proxy', async () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://inbox.test');
    const body = '{"fileId":"file-test","revisionId":"revision-test"}';
    const headers = new Headers(request('POST', 'download', body).headers);
    headers.set('origin', 'https://inbox.test');
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-forwarded-host', 'inbox.test');
    const incoming = new NextRequest('http://127.0.0.1:3000/api/files/download?slot=1', { method: 'POST', headers, body });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic private bytes', { headers: { 'Content-Type': 'application/octet-stream' } })));
    const response = await POST(incoming, params('download'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('synthetic private bytes');
  });

  it('does not trust spoofed proxy headers to select another browser origin', async () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://inbox.test');
    const body = '{"fileId":"file-test","revisionId":"revision-test"}';
    const headers = new Headers(request('POST', 'download', body).headers);
    headers.set('origin', 'https://attacker.test');
    headers.set('host', 'attacker.test');
    headers.set('x-forwarded-host', 'attacker.test');
    headers.set('x-forwarded-proto', 'https');
    headers.set('sec-fetch-site', 'same-origin');
    const incoming = new NextRequest('http://127.0.0.1:3000/api/files/download?slot=1', { method: 'POST', headers, body });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(incoming, params('download'))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never switches an activated authority to another source on missing configuration or malformed inventories', async () => {
    for (const response of [Response.json({ error: 'not_configured' }, { status: 404 }), Response.json({ actorDID: bob, files: null })]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      expect((await GET(request(), params())).status).toBe(502);
    }
    vi.stubEnv('INBOX_FILES_BRIDGE_URL', '');
    expect((await GET(request(), params())).status).toBe(404);
  });

  it.skipIf(process.env.COMAIL_BROWSER_TESTS !== '1')('checks HttpOnly account selection and live denial in Chromium', async () => {
    const fetcher = vi.fn(async () => Response.json({ actorDID: bob, files: [] }));
    vi.stubGlobal('fetch', fetcher);
    const server = createServer(async (req, res) => {
      if (req.url === '/') { res.end('<!doctype html><title>Private file bridge fixture</title>'); return; }
      const incoming = new NextRequest(`http://${req.headers.host}${req.url}`, { headers: req.headers as Record<string, string> });
      const response = await GET(incoming, params());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
      const context = await browser.newContext();
      await context.addCookies([alice, bob].map((did, index) => ({ name: index ? 'jmap_session_1' : 'jmap_session', value: encryptSession('https://mail.test', index ? 'bob@example.test' : 'alice@example.test', 'synthetic', { did, groupwareEnabled: true }), url: base, httpOnly: true, sameSite: 'Lax' as const })));
      const page = await context.newPage(); await page.goto(base);
      expect(await page.evaluate(() => document.cookie)).toBe('');
      expect(await page.evaluate(async () => (await fetch('/api/files/inventory?slot=1')).status)).toBe(200);
      expect(await page.evaluate(async () => (await fetch('/api/files/inventory?slot=0')).status)).toBe(502);
      access.allowed = false;
      const calls = fetcher.mock.calls.length;
      expect(await page.evaluate(async () => (await fetch('/api/files/inventory?slot=1')).status)).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(calls);
    } finally {
      await browser?.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);
});
