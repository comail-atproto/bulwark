/**
 * @vitest-environment node
 *
 * Next forwards ONLY the request headers a middleware lists in
 * `x-middleware-override-headers` and deletes every other one before the
 * route sees the request. proxy() used to list just x-nonce/x-pathname on a
 * bare NextResponse.next(), which stripped RSC, Next-Router-State-Tree,
 * Next-Url, Cookie, ... from every page that skips the intl middleware. Since
 * Next 16.3 the server validates the `_rsc` cache-busting hash against those
 * router headers and 307s on a mismatch, so each navigation and prefetch of a
 * locale-prefixed page looped through 307/200 for about a second (#919).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => {}),
    get: vi.fn((_key: string, fallback: unknown) => fallback),
    getPolicy: vi.fn(() => ({ features: {} })),
  },
}));
vi.mock('@/lib/setup/state', () => ({ detectSetupState: vi.fn(() => 'configured') }));
vi.mock('@/lib/admin/csp-frame-origins', () => ({ getEnabledPluginFrameOrigins: vi.fn(async () => []) }));
// next-intl's ESM middleware build can't be loaded under vitest's node
// resolver (it imports the bare "next/server" specifier). Stand in with the
// behaviour that matters here: it rewrites to the locale-prefixed path and
// forwards the FULL request header set, tagged with the resolved locale.
// With localePrefix "always" it redirects to the prefixed path instead.
let intlMode: 'rewrite' | 'redirect' = 'rewrite';
let receivedAcceptLanguage: string | null = null;
let receivedNextUrl: { pathname: string; basePath: string } | null = null;
let receivedRequest: unknown = null;
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    default: () => (request: Request) => {
      receivedAcceptLanguage = request.headers.get('accept-language');
      receivedRequest = request;
      const { pathname, basePath } = (request as unknown as {
        nextUrl: { pathname: string; basePath: string };
      }).nextUrl;
      receivedNextUrl = { pathname, basePath };
      const url = new URL(request.url);
      url.pathname = `/en${url.pathname}`;
      if (intlMode === 'redirect') return NextResponse.redirect(url);
      const headers = new Headers(request.headers);
      headers.set('x-next-intl-locale', 'en');
      return NextResponse.rewrite(url, { request: { headers } });
    },
  };
});

import { proxy } from '@/proxy';

const ROUTER_HEADERS = {
  rsc: '1',
  'next-router-state-tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(main)%22%5D%7D%5D',
  'next-url': '/en',
  'next-router-prefetch': '1',
  cookie: 'jmap_session_0=abc',
  'accept-language': 'de-DE,de;q=0.9',
};

function forwardedHeaderNames(response: Response): Set<string> {
  return new Set(
    (response.headers.get('x-middleware-override-headers') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function nonceFromCsp(response: Response): string | undefined {
  return /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  intlMode = 'rewrite';
  receivedAcceptLanguage = null;
  receivedNextUrl = null;
  receivedRequest = null;
});

describe('proxy forwards the request headers it does not own (#919)', () => {
  it.each([
    ['a locale-prefixed page (intl middleware skipped)', 'http://localhost:3000/en/calendar?_rsc=abc12', '/en/calendar'],
    ['the locale root', 'http://localhost:3000/en?_rsc=abc12', '/en'],
    ['an admin page', 'http://localhost:3000/admin/plugins', '/admin/plugins'],
    ['a protocol handler page', 'http://localhost:3000/protocol/mailto?url=mailto%3Aa%40b.c', '/protocol/mailto'],
  ])('keeps the router, cookie and language headers on %s', async (_label, url, pathname) => {
    const response = await proxy(new NextRequest(url, { headers: ROUTER_HEADERS }));

    const forwarded = forwardedHeaderNames(response);
    for (const name of Object.keys(ROUTER_HEADERS)) {
      expect(forwarded, `${name} must stay on the request`).toContain(name);
      expect(response.headers.get(`x-middleware-request-${name}`)).toBe(ROUTER_HEADERS[name as keyof typeof ROUTER_HEADERS]);
    }
    // The two headers the proxy adds for the server components.
    expect(forwarded).toContain('x-nonce');
    expect(forwarded).toContain('x-pathname');
    expect(response.headers.get('x-middleware-request-x-pathname')).toBe(pathname);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceFromCsp(response));
    // Not a redirect: the route renders, the RSC hash check sees its headers.
    expect(response.status).toBe(200);
  });

  it('only appends its own headers when the intl middleware already listed the request headers', async () => {
    // Unprefixed path (localePrefix "never" in the test env): next-intl
    // rewrites it and forwards the full header set itself, tagged with the
    // resolved locale.
    const response = await proxy(new NextRequest('http://localhost:3000/calendar?_rsc=abc12', { headers: ROUTER_HEADERS }));

    const forwarded = forwardedHeaderNames(response);
    expect(forwarded).toContain('x-next-intl-locale');
    for (const name of Object.keys(ROUTER_HEADERS)) expect(forwarded).toContain(name);
    expect(forwarded).toContain('x-nonce');
    expect(forwarded).toContain('x-pathname');
    expect(response.headers.get('x-middleware-request-x-pathname')).toBe('/calendar');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceFromCsp(response));
    // Each name once - Next builds a Set, but keep the header tidy.
    const raw = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
    expect(new Set(raw).size).toBe(raw.length);
  });

  it('leaves a locale redirect alone - no route renders, nothing to forward', async () => {
    intlMode = 'redirect';
    const response = await proxy(new NextRequest('http://localhost:3000/calendar', { headers: ROUTER_HEADERS }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/en/calendar');
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
    expect(response.headers.get('x-middleware-request-cookie')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeNull();
  });
});

describe('proxy normalizes Chinese Accept-Language before next-intl matching', () => {
  it.each([
    ['zh-HK,zh;q=0.9', 'zh-TW'],
    ['zh-MO,zh;q=0.9', 'zh-TW'],
    ['zh-Hant-HK,zh-Hant;q=0.9', 'zh-TW'],
    ['zh-Hans-TW,zh-Hans;q=0.9', 'zh'],
    ['zh-CN,zh;q=0.9', 'zh'],
    ['fr-CA,zh-HK;q=0.9', 'fr-CA,zh-HK;q=0.9'],
  ])('passes %s to next-intl as %s', async (acceptLanguage, expected) => {
    await proxy(
      new NextRequest('http://localhost:3000/', {
        headers: { 'accept-language': acceptLanguage, cookie: 'jmap_session_0=abc' },
      }),
    );

    expect(receivedAcceptLanguage).toBe(expected);
  });

  it.each(['en', 'zh', 'zh-TW'])(
    'leaves Accept-Language untouched when a valid NEXT_LOCALE=%s cookie is present',
    async (cookieLocale) => {
      const acceptLanguage = 'zh-HK,zh;q=0.9,en;q=0.8';
      await proxy(
        new NextRequest('http://localhost:3000/', {
          headers: { 'accept-language': acceptLanguage, cookie: `NEXT_LOCALE=${cookieLocale}` },
        }),
      );

      expect(receivedAcceptLanguage).toBe(acceptLanguage);
    },
  );

  it('ignores an invalid locale cookie when normalizing Accept-Language', async () => {
    await proxy(
      new NextRequest('http://localhost:3000/', {
        headers: { 'accept-language': 'zh-HK,zh;q=0.9', cookie: 'NEXT_LOCALE=unsupported' },
      }),
    );

    expect(receivedAcceptLanguage).toBe('zh-TW');
  });
});

describe('normalizing Accept-Language keeps the rest of the request intact', () => {
  // A NextRequest clone re-parses its URL and only strips the base path when it
  // is handed the nextConfig too. Losing it made next-intl rewrite a sub-path
  // install to /<locale>/<basePath>/... instead of /<basePath>/<locale>/....
  it('preserves the base path of a sub-path install', async () => {
    const request = new NextRequest('http://localhost:3000/mail/settings', {
      headers: { 'accept-language': 'zh-HK,zh;q=0.9' },
      nextConfig: { basePath: '/mail' },
    });

    await proxy(request);

    expect(receivedAcceptLanguage).toBe('zh-TW');
    expect(receivedNextUrl).toEqual({ pathname: '/settings', basePath: '/mail' });
  });

  it('passes the original request through when the header needs no collapsing', async () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { 'accept-language': 'zh-TW' },
    });

    await proxy(request);

    expect(receivedRequest).toBe(request);
  });

  it('clones only the headers when the header does need collapsing', async () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { 'accept-language': 'zh-HK,zh;q=0.9' },
    });

    await proxy(request);

    expect(receivedRequest).not.toBe(request);
    expect(receivedAcceptLanguage).toBe('zh-TW');
  });
});
