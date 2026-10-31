// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * End-to-end check for GHSA-24w9-8r42-8jwm: the address validated by the
 * guard must be the one the socket connects to. We keep undici real and only
 * mock DNS, so a name that "rebinds" to loopback at resolution time must be
 * refused by the socket's own lookup - the local server must never see the
 * request.
 */

const lookup = vi.fn();

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    default: { ...actual, lookup: (...args: unknown[]) => lookup(...args) },
    lookup: (...args: unknown[]) => lookup(...args),
  };
});

describe('fetchPublicUrl pins the validated address at connect time', () => {
  let server: Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end('BEGIN:VCALENDAR\nEND:VCALENDAR\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    lookup.mockReset();
    hits = 0;
  });

  it('refuses a hostname that resolves to loopback inside the socket lookup', async () => {
    // The name looks public to any pre-check (no literal IP, no blocked
    // suffix); only the connect-time resolution reveals the rebinding.
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const { fetchPublicUrl, DisallowedUrlError } = await import('@/lib/security/url-guard');

    await expect(fetchPublicUrl(`http://rebind.example:${port}/cal.ics`)).rejects.toBeInstanceOf(
      DisallowedUrlError,
    );
    expect(lookup).toHaveBeenCalled();
    expect(hits).toBe(0);
  });

  it('refuses when a rebinding answer mixes a public and a loopback address', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const { fetchPublicUrl, DisallowedUrlError } = await import('@/lib/security/url-guard');

    await expect(fetchPublicUrl(`http://mixed.example:${port}/cal.ics`)).rejects.toBeInstanceOf(
      DisallowedUrlError,
    );
    expect(hits).toBe(0);
  });

  it('refuses a literal loopback redirect target without touching DNS', async () => {
    const { fetchPublicUrl, DisallowedUrlError } = await import('@/lib/security/url-guard');

    await expect(fetchPublicUrl(`http://127.0.0.1:${port}/cal.ics`)).rejects.toBeInstanceOf(
      DisallowedUrlError,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(hits).toBe(0);
  });
});
