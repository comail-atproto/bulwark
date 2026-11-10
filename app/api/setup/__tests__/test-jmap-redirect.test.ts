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
