import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
  decryptSession: vi.fn(),
  encryptSession: vi.fn(() => 'encrypted-session'),
  setAuthContext: vi.fn(),
  recordLogin: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet, get: mocks.cookieGet })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: mocks.loggerInfo, warn: mocks.loggerWarn },
}));
vi.mock('@/lib/auth/crypto', () => ({ encryptSession: mocks.encryptSession, decryptSession: mocks.decryptSession }));
vi.mock('@/lib/auth/session-cookie', () => ({
  SESSION_COOKIE_MAX_AGE: 3600,
  sessionCookieName: (slot: number) => slot === 0 ? 'jmap_session' : `jmap_session_${slot}`,
}));
vi.mock('@/lib/oauth/cookie-config', () => ({
  getCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
}));
vi.mock('@/lib/auth/verify-jmap-auth', () => ({
  normalizeJmapServerUrl: (url: string) => url,
  validateProxyAuthHeader: vi.fn(),
}));
vi.mock('@/lib/stalwart/auth-context', () => ({
  setStalwartAuthContextInStore: mocks.setAuthContext,
  stalwartAuthContextCookieName: (slot: number) => slot === 0 ? 'jmap_stalwart_ctx' : `jmap_stalwart_ctx_${slot}`,
}));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => undefined),
    get: vi.fn((_key: string, fallback: string) => process.env.JMAP_SERVER_URL ?? fallback),
  },
}));
vi.mock('@/lib/telemetry/login-tracker', () => ({ recordLogin: mocks.recordLogin }));

import { GET, POST } from '@/app/api/auth/relay/route';

const SECRET = 's'.repeat(64);
const CODE = 'c'.repeat(64);
const REDEEM_URL = 'https://relay.internal.example/webmail/sso/redeem';

function postRequest(origin: string, body = `code=${CODE}`): Parameters<typeof POST>[0] {
  const bytes = new TextEncoder().encode(body);
  return {
    headers: new Headers({
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(bytes.byteLength),
    }),
    nextUrl: new URL('https://inbox.example/api/auth/relay'),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as Parameters<typeof POST>[0];
}

describe('/api/auth/relay opaque-code route', () => {
  it.each([
    { INBOX_SSO_PUBLIC_ORIGIN: '' },
    { RELAY_SSO_PUBLIC_ORIGIN: '' },
    { INBOX_SSO_PUBLIC_ORIGIN: 'https://foreign.example' },
  ])('rejects empty/conflicting configured origin %j', async (configuration) => {
    for (const [name, value] of Object.entries(configuration)) vi.stubEnv(name, value);
    const response = await POST(postRequest('https://inbox.example'));
    expect(response.status).toBe(403);
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
    process.env.RELAY_SSO_REDEEM_URL = REDEEM_URL;
    process.env.RELAY_SSO_PUBLIC_ORIGIN = 'https://inbox.example';
    process.env.JMAP_SERVER_URL = 'https://inbox.example';
    vi.clearAllMocks();
    mocks.cookieGet.mockReset();
    mocks.decryptSession.mockReset();
  });

  afterEach(() => {
    delete process.env.BULWARK_RELAY_SSO_SECRET;
    delete process.env.RELAY_SSO_REDEEM_URL;
    delete process.env.RELAY_SSO_PUBLIC_ORIGIN;
    delete process.env.JMAP_SERVER_URL;
    vi.unstubAllGlobals();
  });

  it('keeps an existing mailbox session when signing into a second account', async () => {
    mocks.cookieGet.mockImplementation((name: string) => name === 'jmap_session' ? { value: 'alice-session' } : undefined);
    mocks.decryptSession.mockReturnValue({ serverUrl: 'https://inbox.example', username: 'alice@example.test', password: 'alice-password' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'bob@example.test', app_password: 'bob-password',
      groupware_enabled: false, builders_enabled: false,
    }), { headers: { 'Content-Type': 'application/json' } })));
    const response = await POST(postRequest('https://inbox.example'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?sso_slot=1');
    expect(mocks.cookieSet).toHaveBeenCalledWith('jmap_session_1', 'encrypted-session', expect.anything());
    expect(mocks.cookieSet).not.toHaveBeenCalledWith('jmap_session', expect.anything(), expect.anything());
    expect(mocks.setAuthContext).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ username: 'bob@example.test' }));
  });

  it('refreshes the matching account slot rather than adding a duplicate', async () => {
    mocks.cookieGet.mockImplementation((name: string) => name === 'jmap_session_2' ? { value: 'alice-session' } : undefined);
    mocks.decryptSession.mockReturnValue({ serverUrl: 'https://inbox.example', username: 'alice@example.test', password: 'old-password' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'alice@example.test', app_password: 'new-password',
      groupware_enabled: true, builders_enabled: false,
    }), { headers: { 'Content-Type': 'application/json' } })));
    const response = await POST(postRequest('https://inbox.example'));
    expect(response.headers.get('location')).toBe('/?sso_slot=2');
    expect(mocks.cookieSet).toHaveBeenCalledWith('jmap_session_2', 'encrypted-session', expect.anything());
  });

  it('does not overwrite OAuth sessions or slots with damaged cookies', async () => {
    mocks.cookieGet.mockImplementation((name: string) => ['jmap_rt', 'jmap_session_1'].includes(name) ? { value: 'occupied' } : undefined);
    mocks.decryptSession.mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'bob@example.test', app_password: 'bob-password',
      groupware_enabled: false, builders_enabled: false,
    }), { headers: { 'Content-Type': 'application/json' } })));
    const response = await POST(postRequest('https://inbox.example'));
    expect(response.headers.get('location')).toBe('/?sso_slot=2');
  });

  it.each(['jmap_at', 'jmap_stalwart_ctx'])('preserves a slot occupied only by %s', async (cookieName) => {
    mocks.cookieGet.mockImplementation((name: string) => name === cookieName ? { value: 'occupied' } : undefined);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'bob@example.test', app_password: 'bob-password',
      groupware_enabled: false, builders_enabled: false,
    })));
    expect((await POST(postRequest('https://inbox.example'))).headers.get('location')).toBe('/?sso_slot=1');
  });

  it('rejects a full browser session without overwriting any account', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'occupied' });
    mocks.decryptSession.mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      did: 'did:plc:abcdefghijklmnopqrstuvwx', mailbox: 'bob@example.test', app_password: 'bob-password',
      groupware_enabled: false, builders_enabled: false,
    })));
    expect((await POST(postRequest('https://inbox.example'))).status).toBe(409);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('serves only a no-store CSP bootstrap and never reflects a credential or code', async () => {
    const response = await GET();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(html).toContain('location.hash');
    expect(html).toContain('<meta name="referrer" content="same-origin">');
    expect(html).not.toContain(CODE);
    expect(html).not.toContain('app_password');
  });

  it('rejects a cross-origin form before contacting the relay', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const response = await POST(postRequest('https://attacker.example'));

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it.each(['', 'null'])('rejects an absent or opaque Origin (%s)', async (origin) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const request = postRequest(origin);
    if (!origin) request.headers.delete('origin');

    expect((await POST(request)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('accepts the browser-generated bootstrap POST without leaking its code into URLs or referrers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      did: 'did:plc:abcdefghijklmnopqrstuvwx',
      mailbox: 'browser@example.test',
      app_password: 'synthetic-browser-test-password',
      groupware_enabled: true,
      builders_enabled: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const requests: { method?: string; url?: string; origin?: string; referer?: string }[] = [];
    let origin = '';
    const server = createServer(async (request, response) => {
      try {
        requests.push({ method: request.method, url: request.url,
          origin: request.headers.origin, referer: request.headers.referer });
        if (request.url?.startsWith('/?sso_slot=')) {
          response.end('Signed in');
          return;
        }
        let result: Response;
        if (request.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const routeRequest = postRequest(request.headers.origin ?? '', Buffer.concat(chunks).toString());
          Object.defineProperty(routeRequest, 'nextUrl', { value: new URL(`${origin}/api/auth/relay`) });
          result = await POST(routeRequest);
        } else {
          result = await GET();
        }
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
      } catch {
        response.writeHead(500);
        response.end('Test server failed');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test listener');
    origin = `http://127.0.0.1:${address.port}`;
    process.env.RELAY_SSO_PUBLIC_ORIGIN = origin;
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined,
      });
      const page = await browser.newPage();
      const submission = page.waitForResponse(response => response.request().method() === 'POST');
      await page.goto(`${origin}/api/auth/relay#code=${CODE}`);
      const response = await submission;

      expect(response.status()).toBe(303);
      await page.waitForURL(`${origin}/?sso_slot=0`);
      expect(await page.textContent('body')).toBe('Signed in');
      const post = requests.find(request => request.method === 'POST');
      expect(post?.origin).toBe(origin);
      expect(post?.referer).toBe(`${origin}/api/auth/relay`);
      expect(requests.every(request => !request.url?.includes(CODE) && !request.referer?.includes(CODE))).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(mocks.cookieSet).toHaveBeenCalled();
    } finally {
      await browser?.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it('accepts the configured public origin behind a loopback reverse proxy', async () => {
    const fetcher = vi.fn(async () => new Response('code unavailable', { status: 410 }));
    vi.stubGlobal('fetch', fetcher);
    const request = postRequest('https://inbox.example');
    Object.defineProperty(request, 'nextUrl', { value: new URL('https://127.0.0.1:3000/api/auth/relay') });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not trust forwarded headers to authorize a different browser origin', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const request = postRequest('https://attacker.example');
    request.headers.set('x-forwarded-host', 'attacker.example');
    request.headers.set('x-forwarded-proto', 'https');

    expect((await POST(request)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when the configured public origin is not an origin URL', async () => {
    process.env.RELAY_SSO_PUBLIC_ORIGIN = 'https://inbox.example/other-path';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    expect((await POST(postRequest('https://inbox.example'))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('redeems same-origin codes over the back channel and grants only encrypted cookies', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      did: 'did:plc:abcdefghijklmnopqrstuvwx',
      mailbox: 'alice@example.test',
      app_password: 'server-to-server-only-password',
      groupware_enabled: true,
      builders_enabled: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);

    const response = await POST(postRequest('https://inbox.example'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?sso_slot=0');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledWith(REDEEM_URL, expect.objectContaining({ method: 'POST' }));
    expect(mocks.encryptSession).toHaveBeenCalledWith(
      'https://inbox.example',
      'alice@example.test',
      'server-to-server-only-password',
      { did: 'did:plc:abcdefghijklmnopqrstuvwx', groupwareEnabled: true, buildersEnabled: false },
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'jmap_session',
      'encrypted-session',
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
  });
});
