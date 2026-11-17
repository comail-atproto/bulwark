// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Transform the large client dependency graph before testing fresh evaluation order.
beforeAll(async () => { await import('@/lib/jmap/comail-client'); });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Comail client factories', () => {
  it.each(['auth first', 'client first'] as const)('loads the auth store and client in either order: %s', async (order) => {
    vi.resetModules();
    if (order === 'auth first') await import('@/stores/auth-store');
    const factory = await import('@/lib/jmap/comail-client');
    if (order === 'client first') await import('@/stores/auth-store');
    const basic = factory.createComailClient('https://mail.example.test', 'alice@example.test', 'secret');
    const bearer = factory.createComailBearerClient('https://mail.example.test', 'token', 'alice@example.test');
    expect(factory.isComailClient(basic)).toBe(true);
    expect(factory.isComailClient(bearer)).toBe(true);
    expect(basic.constructor).toBe(bearer.constructor);
  });

  it('uses and refreshes the bearer token on the owned client', async () => {
    const { createComailBearerClient, isComailClient } = await import('@/lib/jmap/comail-client');
    const refresh = vi.fn(async () => 'new-token');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('file', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const client = createComailBearerClient('https://mail.example.test', 'old-token', 'alice@example.test', refresh);
    Object.assign(client, { downloadUrl: 'https://mail.example.test/{accountId}/{blobId}/{name}/{type}', accountId: 'account' });
    expect(isComailClient(client)).toBe(true);
    expect(await (await client.fetchBlob('blob')).text()).toBe('file');
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map(([, init]) => (init.headers as Record<string, string>).Authorization))
      .toEqual(['Bearer old-token', 'Bearer new-token']);
  });
});
