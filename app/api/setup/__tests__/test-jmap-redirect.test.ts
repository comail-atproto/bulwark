/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup/state', () => ({ detectSetupState: () => 'bootstrap' }));
vi.mock('@/lib/setup/session', () => ({ wizardSessionRefusal: async () => null }));
const selected = vi.hoisted(() => ({ url: 'https://mail.example.invalid' }));
vi.mock('@/lib/admin/config-manager', () => ({ configManager: {
  ensureLoaded: async () => {},
  get: () => selected.url,
  setAdminConfig: async (updates: Record<string, unknown>) => {
    if (typeof updates.jmapServerUrl === 'string') selected.url = updates.jmapServerUrl;
  },
} }));
vi.mock('@/lib/telemetry', () => ({ effectiveConsent: vi.fn(), updateState: vi.fn(), reschedule: vi.fn() }));

import { POST } from '../test-jmap/route';
import { POST as saveStep } from '../step/route';

function probe(url: string) {
  return POST(new NextRequest('http://localhost/api/setup/test-jmap', {
    method: 'POST',
    body: JSON.stringify({ url }),
  }));
}

afterEach(() => vi.restoreAllMocks());
beforeEach(() => { selected.url = 'https://mail.example.invalid'; });

describe('setup JMAP server selection and redirects', () => {
  it('saves the first server selection during bootstrap and then probes it', async () => {
    selected.url = '';
    const url = 'https://mail.example.invalid/mail';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"capabilities":{}}'));
    const saved = await saveStep(new NextRequest('http://localhost/api/setup/step', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'server', values: { jmapServerUrl: url } }),
    }));
    expect(saved.status).toBe(200);
    expect(selected.url).toBe(url);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await (await probe(url)).json()).toMatchObject({ status: 'jmap_detected' });
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${url}/.well-known/jmap`);
  });

  it('does not probe an address before a server has been selected', async () => {
    selected.url = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"capabilities":{}}'));
    const response = await probe('https://mail.example.invalid');
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a request for a different server than the saved selection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"capabilities":{}}'));
    const response = await probe('https://other.example.invalid');
    expect(response.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects base URLs containing credentials, a query or a fragment before probing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    for (const url of ['https://user:password@mail.example.invalid', 'https://mail.example.invalid/?key=value', 'https://mail.example.invalid/#section']) {
      selected.url = url;
      const response = await probe(url);
      expect(await response.json()).toMatchObject({ status: 'invalid_url' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows a private configured server with a path', async () => {
    selected.url = 'http://10.0.0.8:8080/mail';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"capabilities":{}}', { status: 200 }));
    const response = await probe('http://10.0.0.8:8080/mail');
    expect(await response.json()).toMatchObject({ status: 'jmap_detected' });
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://10.0.0.8:8080/mail/.well-known/jmap');
  });

  it('does not follow an HTTPS upgrade to a different port', async () => {
    selected.url = 'http://mail.example.invalid:8080';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (new URL(String(input)).port === '8443') throw new Error('Unexpected fetch');
      return new Response(null, { status: 302, headers: { location: 'https://mail.example.invalid:8443/jmap' } });
    });
    await probe('http://mail.example.invalid:8080');
    expect(fetchSpy.mock.calls.every(([url]) => new URL(String(url)).port === '8080')).toBe(true);
  });

  it('allows an HTTPS upgrade to the default port from a custom HTTP port', async () => {
    selected.url = 'http://mail.example.invalid:8080';
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
