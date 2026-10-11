import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.error } }));
vi.mock('@/lib/byomc/relay-bridge', async (original) => ({
  ...await original<typeof import('@/lib/byomc/relay-bridge')>(),
  sessionMailbox: async () => 'owner@example.test',
}));
import { GET } from '@/app/api/byomc/app-passwords/[[...seg]]/route';

describe('Inbox app-password private bridge', () => {
  beforeEach(() => {
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'i'.repeat(64));
    vi.stubEnv('INBOX_APP_PASSWORD_BRIDGE_URL', 'https://inbox.private.example/webmail/app-passwords');
    vi.stubEnv('BULWARK_RELAY_SSO_SECRET', undefined);
    vi.stubEnv('RELAY_APP_PASSWORD_BRIDGE_URL', undefined);
    mocks.error.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('bounds the backchannel and keeps credentials out of cache', async () => {
    const fetcher = vi.fn(async () => new Response('{"password":"synthetic-canary"}', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(new NextRequest('https://inbox.example/api/byomc/app-passwords'), { params: Promise.resolve({}) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe('error'); expect(init.cache).toBe('no-store'); expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not log endpoint or credential text from transport failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('https://inbox.private.example?token=synthetic-canary'); }));
    const response = await GET(new NextRequest('https://inbox.example/api/byomc/app-passwords'), { params: Promise.resolve({}) });
    expect(response.status).toBe(502); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('synthetic-canary');
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('inbox.private.example');
  });
  it('fails closed if response streaming fails after headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private-url-canary')); } }))));
    const response = await GET(new NextRequest('https://inbox.example/api/byomc/app-passwords'), { params: Promise.resolve({}) });
    expect(response.status).toBe(502); expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
