import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/admin/paths', () => ({ getConfigDir: () => '/config' }));
vi.mock('@/lib/security/url-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/url-guard')>();
  return { ...actual, fetchPublicUrl: vi.fn() };
});

import { fetchPublicUrl, DisallowedUrlError } from '@/lib/security/url-guard';
import { fetchBrandingAsset } from '@/lib/admin/branding-asset';

const guardedFetch = fetchPublicUrl as unknown as Mock;

beforeEach(() => {
  guardedFetch.mockReset();
});

describe('fetchBrandingAsset (remote URLs)', () => {
  it('fetches remote assets through the rebinding-safe fetch', async () => {
    guardedFetch.mockResolvedValueOnce(new Response('PNG', { status: 200 }));
    const buf = await fetchBrandingAsset('https://cdn.example.com/logo.png', 'logo');
    expect(buf.toString()).toBe('PNG');
    expect(guardedFetch.mock.calls[0][0]).toBe('https://cdn.example.com/logo.png');
  });

  it('re-validates every redirect hop', async () => {
    guardedFetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn2.example.com/logo.png' } }))
      .mockResolvedValueOnce(new Response('PNG2', { status: 200 }));
    const buf = await fetchBrandingAsset('https://cdn.example.com/logo.png', 'logo');
    expect(buf.toString()).toBe('PNG2');
    expect(guardedFetch.mock.calls[1][0]).toBe('https://cdn2.example.com/logo.png');
  });

  it('surfaces a blocked address as an error', async () => {
    guardedFetch.mockRejectedValueOnce(new DisallowedUrlError('http://169.254.169.254/'));
    await expect(fetchBrandingAsset('http://169.254.169.254/', 'logo')).rejects.toBeInstanceOf(DisallowedUrlError);
  });

  it('reports non-2xx upstream status', async () => {
    guardedFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(fetchBrandingAsset('https://cdn.example.com/missing.png', 'logo')).rejects.toThrow('Failed to fetch logo: 404');
  });
});
