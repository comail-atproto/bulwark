import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.fn();

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    default: { ...actual, lookup: (...args: unknown[]) => lookup(...args) },
    lookup: (...args: unknown[]) => lookup(...args),
  };
});

async function load() {
  return import('@/lib/telemetry/endpoint-guard');
}

describe('telemetry endpoint guard', () => {
  beforeEach(() => {
    lookup.mockReset();
    delete process.env.BULWARK_TELEMETRY_ALLOW_PRIVATE;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('parseV6Groups', () => {
    it('expands compressed and embedded-IPv4 forms', async () => {
      const { parseV6Groups } = await load();
      expect(parseV6Groups('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(parseV6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseV6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
      expect(parseV6Groups('::ffff:7f00:1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
      expect(parseV6Groups('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
      expect(parseV6Groups('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseV6Groups('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('rejects malformed input', async () => {
      const { parseV6Groups } = await load();
      expect(parseV6Groups('1::2::3')).toBeNull();
      expect(parseV6Groups('1:2:3')).toBeNull();
      expect(parseV6Groups('1:2:3:4:5:6:7:8:9')).toBeNull();
      expect(parseV6Groups('::ffff:999.0.0.1')).toBeNull();
      expect(parseV6Groups('::fffff')).toBeNull();
      expect(parseV6Groups('::zz')).toBeNull();
    });
  });

  describe('isPrivateAddress', () => {
    it('keeps the IPv4 coverage', async () => {
      const { isPrivateAddress } = await load();
      for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
        expect(isPrivateAddress(ip), ip).toBe(true);
      }
      expect(isPrivateAddress('93.184.216.34')).toBe(false);
      expect(isPrivateAddress('8.8.8.8')).toBe(false);
    });

    it('blocks the classic IPv6 special ranges', async () => {
      const { isPrivateAddress } = await load();
      for (const ip of ['::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', 'ff05::2']) {
        expect(isPrivateAddress(ip), ip).toBe(true);
      }
    });

    it('blocks IPv4-mapped addresses in both dotted and hex spelling', async () => {
      const { isPrivateAddress } = await load();
      expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
      expect(isPrivateAddress('::FFFF:7F00:1')).toBe(true);
      expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true);  // 169.254.169.254
      expect(isPrivateAddress('::ffff:c0a8:101')).toBe(true);   // 192.168.1.1
      expect(isPrivateAddress('::ffff:5db8:d822')).toBe(false); // 93.184.216.34
      expect(isPrivateAddress('::ffff:93.184.216.34')).toBe(false);
    });

    it('blocks deprecated IPv4-compatible addresses by their embedded address', async () => {
      const { isPrivateAddress } = await load();
      expect(isPrivateAddress('::7f00:1')).toBe(true);
      expect(isPrivateAddress('::127.0.0.1')).toBe(true);
      expect(isPrivateAddress('::5db8:d822')).toBe(false);
    });

    it('judges NAT64 addresses by the embedded IPv4 address', async () => {
      const { isPrivateAddress } = await load();
      expect(isPrivateAddress('64:ff9b::a9fe:a9fe')).toBe(true);      // 169.254.169.254
      expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true);         // 127.0.0.1
      expect(isPrivateAddress('64:ff9b::169.254.169.254')).toBe(true);
      expect(isPrivateAddress('64:ff9b::5db8:d822')).toBe(false);     // public, DNS64 case
      expect(isPrivateAddress('64:ff9b:1::a9fe:a9fe')).toBe(true);    // local-use prefix, blanket
      expect(isPrivateAddress('64:ff9b:1:2:3::5db8:d822')).toBe(true);
    });

    it('judges 6to4 addresses by the embedded IPv4 address', async () => {
      const { isPrivateAddress } = await load();
      expect(isPrivateAddress('2002:a9fe:a9fe::1')).toBe(true);
      expect(isPrivateAddress('2002:7f00:1::1')).toBe(true);
      expect(isPrivateAddress('2002:5db8:d822::1')).toBe(false);
    });

    it('blocks the Teredo prefix but not other 2001:: space', async () => {
      const { isPrivateAddress } = await load();
      expect(isPrivateAddress('2001::1')).toBe(true);
      expect(isPrivateAddress('2001:0:1234:5678::1')).toBe(true);
      expect(isPrivateAddress('2001:db8::1')).toBe(false);
      expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
    });

    it('does not flag ordinary global unicast', async () => {
      const { isPrivateAddress } = await load();
      expect(isPrivateAddress('2606:4700::6810:84e5')).toBe(false);
      expect(isPrivateAddress('2a00:1450:4001:80e::200e')).toBe(false);
    });
  });

  describe('validateEndpointUrl (literal IP path)', () => {
    it('rejects transition/mapped literals even after WHATWG normalisation', async () => {
      const { validateEndpointUrl } = await load();
      // new URL() rewrites [::ffff:127.0.0.1] to [::ffff:7f00:1]; both must fail.
      for (const url of [
        'http://[::ffff:127.0.0.1]:3000/',
        'http://[::ffff:7f00:1]:3000/',
        'http://[::ffff:a9fe:a9fe]/',
        'http://[64:ff9b::a9fe:a9fe]/',
        'http://[2002:a9fe:a9fe::1]/',
        'http://[2001:0:1234::1]/',
        'http://[ff02::1]/',
        'http://[::1]/',
        'http://127.0.0.1/',
        'http://169.254.169.254/',
      ]) {
        expect(validateEndpointUrl(url), url).toEqual({
          ok: false, reason: 'private/loopback IP is not allowed',
        });
      }
    });

    it('accepts public literals and hostnames', async () => {
      const { validateEndpointUrl } = await load();
      expect(validateEndpointUrl('https://93.184.216.34/collect')).toEqual({ ok: true });
      expect(validateEndpointUrl('https://[2606:4700::6810:84e5]/collect')).toEqual({ ok: true });
      expect(validateEndpointUrl('https://[64:ff9b::5db8:d822]/collect')).toEqual({ ok: true });
      expect(validateEndpointUrl('https://telemetry.example.org/collect')).toEqual({ ok: true });
    });

    it('honours the dev bypass', async () => {
      process.env.BULWARK_TELEMETRY_ALLOW_PRIVATE = '1';
      const { validateEndpointUrl } = await load();
      expect(validateEndpointUrl('http://[::ffff:7f00:1]:3000/')).toEqual({ ok: true });
    });
  });

  describe('resolveEndpointAllowed (DNS path)', () => {
    it('rejects hostnames whose AAAA record is a transition address', async () => {
      lookup.mockResolvedValue([{ address: '64:ff9b::a9fe:a9fe', family: 6 }]);
      const { resolveEndpointAllowed } = await load();
      const r = await resolveEndpointAllowed('https://evil.example.org/');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('64:ff9b::a9fe:a9fe');
    });

    it('rejects hostnames whose AAAA record is a v4-mapped private address', async () => {
      lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '::ffff:10.0.0.5', family: 6 },
      ]);
      const { resolveEndpointAllowed } = await load();
      expect((await resolveEndpointAllowed('https://evil.example.org/')).ok).toBe(false);
    });

    it('accepts hostnames resolving only to public addresses', async () => {
      lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ]);
      const { resolveEndpointAllowed } = await load();
      expect(await resolveEndpointAllowed('https://telemetry.example.org/')).toEqual({ ok: true });
    });

    it('does not consult DNS for a literal it already rejected', async () => {
      const { resolveEndpointAllowed } = await load();
      expect((await resolveEndpointAllowed('http://[::ffff:7f00:1]/')).ok).toBe(false);
      expect(lookup).not.toHaveBeenCalled();
    });
  });
});
