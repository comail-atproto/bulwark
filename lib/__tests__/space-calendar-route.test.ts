import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { NextRequest } from 'next/server';
import { chromium } from 'playwright';
import { encryptSession } from '@/lib/auth/crypto';
import { configManager } from '@/lib/admin/config-manager';
import { GET, POST, PUT } from '@/app/api/calendar/[[...seg]]/route';

const routeConfig = vi.hoisted(() => ({ calendarEnabled: true, demoMode: false }));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => {}),
    get: vi.fn((key: string, fallback: unknown) => key === 'calendarEnabled' ? routeConfig.calendarEnabled
      : key === 'demoMode' ? routeConfig.demoMode : fallback),
  },
}));

const BASE = 'https://inbox.test/webmail/calendar/api/v1';
const SECRET = 'calendar-bridge-test-secret'.repeat(2);
function sessionTokens(aliceGroupware: boolean | null = true, bobGroupware: boolean | null = true): { alice: string; bob: string } {
  const alice = encryptSession('https://mail.test', 'alice@example.test', 'alice-password', {
    did: 'did:plc:alice', ...(aliceGroupware === null ? {} : { groupwareEnabled: aliceGroupware }),
  });
  const bob = encryptSession('https://mail.test', 'bob@example.test', 'bob-password', {
    did: 'did:plc:bob', ...(bobGroupware === null ? {} : { groupwareEnabled: bobGroupware }),
  });
  return { alice, bob };
}

function bothSessionCookies(aliceGroupware: boolean | null = true, bobGroupware: boolean | null = true): string {
  const sessions = sessionTokens(aliceGroupware, bobGroupware);
  return `jmap_session=${sessions.alice}; jmap_session_1=${sessions.bob}`;
}

function request(method: string, url: string, opts: { cookie?: string; body?: string; origin?: string; fetchSite?: string } = {}): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.fetchSite ? { 'sec-fetch-site': opts.fetchSite } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
}

function tokenClaims(input: RequestInfo | URL, init?: RequestInit): Record<string, unknown> {
  const authorization = new Headers(init?.headers).get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer assertion');
  const payload = authorization.slice('Bearer '.length).split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('/api/calendar same-origin bridge', () => {
  it('forwards only the fixed metadata selector through the entitled slot', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ events: [], metadata: {} }));
    vi.stubGlobal('fetch', fetcher);
    const prefix = 'https://bulwark.test/api/calendar/events?slot=1&after=2026-10-08T00%3A00%3A00Z&before=2026-10-09T00%3A00%3A00Z';
    const response = await GET(request('GET', `${prefix}&includeMetadata=true`, { cookie: bothSessionCookies() }), { params: Promise.resolve({ seg: ['events'] }) });
    expect(response.status).toBe(200);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('includeMetadata')).toBe('true');
    expect(tokenClaims(fetcher.mock.calls[0][0], fetcher.mock.calls[0][1])).toMatchObject({ mailbox: 'bob@example.test' });
    fetcher.mockClear();
    for (const query of ['includeMetadata=false', 'includeMetadata=true&includeMetadata=true', 'includeMetadata=True']) {
      const rejected = await GET(request('GET', `${prefix}&${query}`, { cookie: bothSessionCookies() }), { params: Promise.resolve({ seg: ['events'] }) });
      expect(rejected.status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });


  it('forwards actor-private commands only through the selected entitled slot', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'event1' }));
    vi.stubGlobal('fetch', fetcher);
    const body = JSON.stringify({ requestId: 'private-update-0001', basePersonalRevision: `personal-state-${'a'.repeat(64)}`, patch: { color: 'red' } });
    for (const enabled of [false, true, false]) {
      const req = request('PUT', 'https://bulwark.test/api/calendar/events/event1/personal?slot=1', {
        cookie: bothSessionCookies(true, enabled), fetchSite: 'same-origin', body,
      });
      const response = await PUT(req, { params: Promise.resolve({ seg: ['events', 'event1', 'personal'] }) });
      expect(response.status).toBe(enabled ? 200 : 404);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${BASE}/events/event1/personal`);
    expect(fetcher.mock.calls[0][1]?.body).toBe(body);
    expect(tokenClaims(...fetcher.mock.calls[0])).toMatchObject({ mailbox: 'bob@example.test' });
  });

  it.each(['owner-personal', 'member-personal'])('preserves the typed %s consent and fixed ticket route', async (profile) => {
    const ticket = `https://space-host.test/oauth/calendar/tickets/${'A'.repeat(43)}`;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: 'authorization_required', authorizationProfile: profile, credential: 'synthetic-do-not-expose' }, { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=1', { cookie: bothSessionCookies() });
    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });
    expect(await response.json()).toEqual({ error: 'authorization_required', authorizationProfile: profile });
    fetcher.mockImplementation(async () => Response.json({ status: 'authorization_required', authorizationUrl: ticket }, { status: 202 }));
    const start = request('POST', 'https://bulwark.test/api/calendar/personal/start?slot=1', {
      cookie: bothSessionCookies(), fetchSite: 'same-origin', body: '{"requestId":"private-consent-0001"}',
    });
    const authorized = await POST(start, { params: Promise.resolve({ seg: ['personal', 'start'] }) });
    expect(authorized.status).toBe(202);
    expect(await authorized.json()).toEqual({ status: 'authorization_required', authorizationUrl: ticket });
    expect(String(fetcher.mock.calls[1][0])).toBe(`${BASE}/personal/start`);
    expect(tokenClaims(fetcher.mock.calls[1][0], fetcher.mock.calls[1][1])).toMatchObject({ mailbox: 'bob@example.test' });
  });

  it('forwards public actions and keeps owner-public consent on its distinct start route', async () => {
    const ticket = `https://space-host.test/oauth/calendar/tickets/${'A'.repeat(43)}`;
    const rsvpBody = JSON.stringify({
      requestId: 'public-rsvp-0001',
      eventUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      eventCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      expectedRsvpCid: null,
      status: 'going',
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'authorization_required', authorizationProfile: 'owner-public' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: 'authorization_required', authorizationUrl: ticket }, { status: 202 }));
    vi.stubGlobal('fetch', fetcher);

    const action = request('POST', 'https://bulwark.test/api/calendar/public/rsvps?slot=1', {
      cookie: bothSessionCookies(), fetchSite: 'same-origin', body: rsvpBody,
    });
    const pending = await POST(action, { params: Promise.resolve({ seg: ['public', 'rsvps'] }) });

    expect(pending.status).toBe(409);
    expect(await pending.json()).toEqual({ error: 'authorization_required', authorizationProfile: 'owner-public' });
    expect(String(fetcher.mock.calls[0][0])).toBe(`${BASE}/public/rsvps`);
    expect(fetcher.mock.calls[0][1]?.body).toBe(rsvpBody);

    const startBody = '{"requestId":"public-consent-0001"}';
    const start = request('POST', 'https://bulwark.test/api/calendar/public/start?slot=1', {
      cookie: bothSessionCookies(), fetchSite: 'same-origin', body: startBody,
    });
    const authorized = await POST(start, { params: Promise.resolve({ seg: ['public', 'start'] }) });

    expect(authorized.status).toBe(202);
    expect(await authorized.json()).toEqual({ status: 'authorization_required', authorizationUrl: ticket });
    expect(String(fetcher.mock.calls[1][0])).toBe(`${BASE}/public/start`);
    expect(fetcher.mock.calls[1][1]?.body).toBe(startBody);
    expect(tokenClaims(fetcher.mock.calls[1][0], fetcher.mock.calls[1][1])).toMatchObject({ mailbox: 'bob@example.test' });
  });

  it.each([
    ['subscriptions', ['subscriptions']],
    ['public event publication', ['public', 'events']],
  ] as const)('forwards the fixed %s action route', async (_name, seg) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ uri: 'at://did:plc:member/community.lexicon.calendar.event/3m3z2a2b3c4d5', cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    vi.stubGlobal('fetch', fetcher);
    const body = '{"requestId":"public-action-0001"}';
    const suffix = seg.join('/');
    const req = request('POST', `https://bulwark.test/api/calendar/${suffix}?slot=1`, {
      cookie: bothSessionCookies(), fetchSite: 'same-origin', body,
    });

    const response = await POST(req, { params: Promise.resolve({ seg: [...seg] }) });

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${BASE}/${suffix}`);
    expect(fetcher.mock.calls[0][1]?.body).toBe(body);
  });

  beforeEach(() => {
    routeConfig.calendarEnabled = true;
    routeConfig.demoMode = false;
    vi.mocked(configManager.get).mockImplementation((key, fallback) => key === 'calendarEnabled' ? routeConfig.calendarEnabled
      : key === 'demoMode' ? routeConfig.demoMode : fallback);
    vi.stubEnv('SESSION_SECRET', 'session-test-secret'.repeat(3));
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', SECRET);
    vi.stubEnv('INBOX_CALENDAR_BRIDGE_URL', BASE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the exact selected encrypted session slot and sends mailbox only', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => Response.json({ calendars: [] }));
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=1', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${BASE}/calendars`);
    expect(tokenClaims(...fetcher.mock.calls[0])).toMatchObject({
      mailbox: 'bob@example.test', iss: 'comail-bulwark', aud: 'comail-calendar',
    });
    const claims = tokenClaims(...fetcher.mock.calls[0]);
    expect(claims).not.toHaveProperty('sub');
    expect(claims).not.toHaveProperty('did');
    expect(claims).not.toHaveProperty('space_uri');
  });

  it('does not fall back to another valid session when the selected slot is missing', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=2', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('denies a selected session without groupware entitlement despite another enabled slot and demo mode', async () => {
    routeConfig.demoMode = true;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', {
      cookie: `${bothSessionCookies(false, true)}; groupware_enabled=1`,
    });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('denies canonical calendar access when the operator calendar setting is off', async () => {
    routeConfig.calendarEnabled = false;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not let a legacy session feature cookie grant calendar access without an encrypted groupware claim', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', {
      cookie: `jmap_session=${sessionTokens(null, true).alice}; groupware_enabled=1`,
    });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not forward member authorization starts for a session without groupware entitlement', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('POST', 'https://bulwark.test/api/calendar/member/consent/start?slot=0', {
      cookie: bothSessionCookies(false, true),
      body: '{"requestId":"request-disabled-member"}',
    });

    const response = await POST(req, { params: Promise.resolve({ seg: ['member', 'consent', 'start'] }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects duplicate or unrelated account and date selectors', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const cookies = bothSessionCookies();
    const duplicateSlot = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0&slot=1', { cookie: cookies });
    const duplicateRange = request('GET', 'https://bulwark.test/api/calendar/events?slot=0&after=2026-10-08T00%3A00%3A00Z&after=2026-10-09T00%3A00%3A00Z&before=2026-10-10T00%3A00%3A00Z', { cookie: cookies });

    expect((await GET(duplicateSlot, { params: Promise.resolve({ seg: ['calendars'] }) })).status).toBe(400);
    expect((await GET(duplicateRange, { params: Promise.resolve({ seg: ['events'] }) })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects cross-origin commands before reading or forwarding the command', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('PUT', 'https://bulwark.test/api/calendar/events/event1?slot=0', {
      cookie: bothSessionCookies(),
      origin: 'https://attacker.test',
      fetchSite: 'cross-site',
      body: '{"requestId":"r","baseRevision":"v","patch":{"title":"x"}}',
    });

    const response = await PUT(req, { params: Promise.resolve({ seg: ['events', 'event1'] }) });

    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not follow provider redirects', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      throw new TypeError('redirect blocked');
    });
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(502);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports an unconfigured bridge as no Space calendar source', async () => {
    vi.stubEnv('INBOX_CALENDAR_BRIDGE_URL', '');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds command request and provider response bodies', async () => {
    const req = request('PUT', 'https://bulwark.test/api/calendar/events/event1?slot=0', {
      cookie: bothSessionCookies(),
      fetchSite: 'same-origin',
      body: JSON.stringify({ patch: { title: 'x'.repeat(65 * 1024) } }),
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ detail: 'x'.repeat(2 * 1024 * 1024) }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    expect((await PUT(req, { params: Promise.resolve({ seg: ['events', 'event1'] }) })).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();

    const getReq = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });
    const largeResponse = await GET(getReq, { params: Promise.resolve({ seg: ['calendars'] }) });
    expect(largeResponse.status).toBe(502);
    expect(await largeResponse.json()).toEqual({ error: 'provider_unavailable' });
  });

  it('does not forward arbitrary upstream MIME types or diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<private upstream error>', {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    })));
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'provider_unavailable' });
  });

  it('preserves a known configured-calendar outage status and code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'calendar_unavailable' }, { status: 503 })));
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'calendar_unavailable' });
  });

  it('passes only the fixed pending-consent calendar catalog from a typed member response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'authorization_required', authorizationProfile: 'member-calendar',
      calendar: {
        id: 'cal_fixed', name: 'Project', source: 'atproto-space', initialized: null,
        pendingConsent: true, revisionId: null, policyId: null, myRole: null,
      },
    }, { status: 409 })));
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'authorization_required', authorizationProfile: 'member-calendar',
      calendar: {
        id: 'cal_fixed', name: 'Project', source: 'atproto-space', initialized: null,
        pendingConsent: true, revisionId: null, policyId: null, myRole: null,
      },
    });
  });

  it('drops pending catalog data that includes unapproved identity or provider fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'authorization_required', authorizationProfile: 'member-calendar',
      calendar: {
        id: 'cal_fixed', name: 'Project', source: 'atproto-space', initialized: null,
        pendingConsent: true, revisionId: null, policyId: null, myRole: null,
        space_uri: 'did:plc:private/space',
      },
    }, { status: 409 })));
    const req = request('GET', 'https://bulwark.test/api/calendar/calendars?slot=0', { cookie: bothSessionCookies() });

    const response = await GET(req, { params: Promise.resolve({ seg: ['calendars'] }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'authorization_required', authorizationProfile: 'member-calendar' });
  });

  it('accepts only the typed server-derived authorization ticket response', async () => {
    const ticketUrl = 'https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ status: 'authorization_required', authorizationUrl: ticketUrl }, { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    const req = request('POST', 'https://bulwark.test/api/calendar/owner/data/start?slot=0', {
      cookie: bothSessionCookies(), fetchSite: 'same-origin', body: '{"requestId":"request-1"}',
    });

    const response = await POST(req, { params: Promise.resolve({ seg: ['owner', 'data', 'start'] }) });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'authorization_required', authorizationUrl: ticketUrl });
    expect(String(fetcher.mock.calls[0][0])).toBe(`${BASE}/owner/data/start`);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects malformed ticket paths before returning a navigation URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      status: 'authorization_required', authorizationUrl: 'https://space-host.test/oauth/calendar/tickets/short',
    }, { status: 202 })));
    const req = request('POST', 'https://bulwark.test/api/calendar/owner/data/start?slot=0', {
      cookie: bothSessionCookies(), fetchSite: 'same-origin', body: '{"requestId":"request-1"}',
    });

    const response = await POST(req, { params: Promise.resolve({ seg: ['owner', 'data', 'start'] }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'provider_unavailable' });
  });

  // Allow browser startup and teardown on shared workers; page actions keep their own deadlines.
  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('keeps browser account-slot selection bound to each encrypted session', async () => {
    const assertions: Record<string, unknown>[] = [];
    const sessions = sessionTokens();
    const browserRequests: Array<{ method?: string; url?: string; origin?: string; referer?: string; fetchSite?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      assertions.push(tokenClaims(input, init));
      if (String(input).endsWith('/owner/data/start') || String(input).endsWith('/personal/start')) {
        return Response.json({ status: 'authorization_required', authorizationUrl: 'https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG' }, { status: 202 });
      }
      return Response.json({ events: [] });
    }));

    let origin = '';
    const server = createServer(async (incoming, outgoing) => {
      if (incoming.url === '/') {
        outgoing.writeHead(200, { 'Content-Type': 'text/html' });
        outgoing.end('<!doctype html><html><body><form><input id="event-title" value="Draft event"></form><button id="authorize" type="button">Authorize</button></body></html>');
        return;
      }
      try {
        browserRequests.push({ method: incoming.method, url: incoming.url, origin: incoming.headers.origin,
          referer: incoming.headers.referer, fetchSite: incoming.headers['sec-fetch-site'] });
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
        const url = new URL(incoming.url ?? '/', origin);
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const req = new NextRequest(url, {
          method: incoming.method,
          headers,
          ...(body !== undefined ? { body } : {}),
        });
        const seg = url.pathname.split('/').filter(Boolean).slice(2);
        const response = incoming.method === 'GET'
          ? await GET(req, { params: Promise.resolve({ seg }) })
          : incoming.method === 'POST'
            ? await POST(req, { params: Promise.resolve({ seg }) })
            : await PUT(req, { params: Promise.resolve({ seg }) });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(await response.text());
      } catch {
        outgoing.writeHead(500);
        outgoing.end('Test server failed');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test listener');
    origin = `http://127.0.0.1:${address.port}`;
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
      const context = await browser.newContext();
      await context.route('https://space-host.test/**', route => route.fulfill({ status: 200, body: 'ticket test' }));
      await context.addCookies([
        { name: 'jmap_session', value: sessions.alice, url: origin, httpOnly: true, sameSite: 'Lax' },
        { name: 'jmap_session_1', value: sessions.bob, url: origin, httpOnly: true, sameSite: 'Lax' },
      ]);
      const page = await context.newPage();
      await page.goto(origin);
      const statuses = await page.evaluate(async () => {
        const list = await fetch('/api/calendar/calendars?slot=0');
        const start = await fetch('/api/calendar/owner/data/start?slot=0', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'browser-start' }),
        });
        const startBody = await start.json();
        (window as Window & { authorizationUrl?: string }).authorizationUrl = startBody.authorizationUrl;
        document.querySelector('#authorize')?.addEventListener('click', () => {
          const authorizationUrl = (window as Window & { authorizationUrl?: string }).authorizationUrl;
          if (authorizationUrl) window.open(authorizationUrl, '_blank', 'noopener,noreferrer');
        });
        const send = async (slot: number) => {
          const response = await fetch(`/api/calendar/events/event1?slot=${slot}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: `request-${slot}`, baseRevision: 'rev', patch: { title: 'Test' } }),
          });
          return response.status;
        };
        const shared = [list.status, start.status, await send(0), await send(1)];
        const personalStart = await fetch('/api/calendar/personal/start?slot=1', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'private-browser-start' }),
        });
        const personalSave = await fetch('/api/calendar/events/event1/personal?slot=1', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: 'private-browser-save', basePersonalRevision: `personal-state-${'a'.repeat(64)}`, patch: { color: 'red' } }),
        });
        return [...shared, personalStart.status, personalSave.status];
      });

      expect(statuses).toEqual([200, 202, 200, 200, 202, 200]);
      expect(assertions.map((claims) => claims.mailbox)).toEqual(['alice@example.test', 'alice@example.test', 'alice@example.test', 'bob@example.test', 'bob@example.test', 'bob@example.test']);
      expect(assertions.every((claims) => !('did' in claims) && !('sub' in claims))).toBe(true);
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#authorize').click()]);
      await popup.waitForLoadState('domcontentloaded');
      expect(popup.url()).toBe('https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
      expect(await page.locator('#event-title').inputValue()).toBe('Draft event');
      expect(page.url()).toBe(origin + '/');
      const browserGet = browserRequests.find((entry) => entry.method === 'GET');
      expect(browserGet?.fetchSite).toBe('same-origin');
      expect(browserGet?.referer).toBe(`${origin}/`);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 90_000);
});
