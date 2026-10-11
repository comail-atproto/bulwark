import { describe, it, expect, vi, afterEach } from 'vitest';

// The App Router serves /favicon.ico from app/favicon.ico/route.ts. Browsers
// request /favicon.ico unconditionally; without this route the request 404s
// (issue #1768). The route redirects to the configured Comail favicon PNG.
async function loadRoute(basePath?: string) {
  vi.resetModules();
  if (basePath === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  } else {
    process.env.NEXT_PUBLIC_BASE_PATH = basePath;
  }
  return import('@/app/favicon.ico/route');
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  vi.resetModules();
});

describe('GET /favicon.ico', () => {
  it('does not 404 - returns a redirect (3xx)', async () => {
    const { GET } = await loadRoute(undefined);
    const res = await GET();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it('points at the Comail favicon PNG', async () => {
    const { GET } = await loadRoute(undefined);
    const res = await GET();
    const location = res.headers.get('location') || '';
    expect(location).toContain('/branding/comail/comail-favicon.png');
  });

  it('honors the subpath base path in the redirect target', async () => {
    const { GET } = await loadRoute('/webmail');
    const res = await GET();
    const location = res.headers.get('location') || '';
    expect(location).toBe('/webmail/branding/comail/comail-favicon.png');
  });
});
