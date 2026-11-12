/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup/state', () => ({ detectSetupState: () => 'bootstrap' }));
vi.mock('@/lib/setup/session', () => ({ wizardSessionRefusal: async () => null }));

import { POST } from '../test-jmap/route';

function probe(url: string) {
  return POST(new NextRequest('http://localhost/api/setup/test-jmap', {
    method: 'POST',
    body: JSON.stringify({ url }),
  }));
}

afterEach(() => vi.restoreAllMocks());

describe('setup JMAP redirects', () => {
  it('rejects base URLs containing credentials, a query or a fragment before probing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    for (const url of ['https://user:password@mail.example.invalid', 'https://mail.example.invalid/?key=value', 'https://mail.example.invalid/#section']) {
      const response = await probe(url);
      expect(await response.json()).toMatchObject({ status: 'invalid_url' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows a private configured server with a path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"capabilities":{}}', { status: 200 }));
    const response = await probe('http://10.0.0.8:8080/mail');
    expect(await response.json()).toMatchObject({ status: 'jmap_detected' });
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://10.0.0.8:8080/mail/.well-known/jmap');
  });

  it('does not follow an HTTPS upgrade to a different port', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (new URL(String(input)).port === '8443') throw new Error('Unexpected fetch');
      return new Response(null, { status: 302, headers: { location: 'https://mail.example.invalid:8443/jmap' } });
    });
    await probe('http://mail.example.invalid:8080');
    expect(fetchSpy.mock.calls.every(([url]) => new URL(String(url)).port === '8080')).toBe(true);
  });

  it('allows an HTTPS upgrade to the default port from a custom HTTP port', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.protocol === 'http:') return new Response(null, { status: 302, headers: { location: 'https://mail.example.invalid/jmap' } });
      return new Response('{"capabilities":{}}', { status: 200 });
    });
    const result = await probe('http://mail.example.invalid:8080');
    expect(await result.json()).toMatchObject({ status: 'jmap_detected' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
