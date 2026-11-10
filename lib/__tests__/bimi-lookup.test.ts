// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { createBimiResolver, normalizeBimiDomain } from '@/lib/bimi/lookup';

const LOGO = '<svg version="1.2" baseProfile="tiny-ps" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Brand</title><rect width="10" height="10" fill="#c00"/></svg>';
const fixtures = path.join(__dirname, 'fixtures', 'bimi');
const fixture = (name: string) => readFileSync(path.join(fixtures, `${name}.pem`), 'utf8');

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** A resolver over fake DNS records and URLs; unknown names are NXDOMAIN. */
function setup(records: Record<string, string[]>, urls: Record<string, string> = {}, now = Date.UTC(2026, 9, 29)) {
  const clock = { now };
  const resolveTxt = vi.fn(async (name: string) => {
    if (records[name]) return records[name].map((r) => [r]);
    throw dnsError('ENOTFOUND');
  });
  const fetchBytes = vi.fn(async (url: string) => (url in urls ? new Uint8Array(Buffer.from(urls[url])) : null));
  const resolver = createBimiResolver({
    resolveTxt,
    fetchBytes,
    roots: () => [new X509Certificate(fixture('root'))],
    now: () => clock.now,
  });
  return { resolver, resolveTxt, fetchBytes, clock };
}

describe('BIMI resolver', () => {
  it('shows a self-published logo when DMARC enforces', async () => {
    const { resolver } = setup(
      { '_dmarc.brand.org': ['v=DMARC1; p=reject'], 'default._bimi.brand.org': ['v=BIMI1; l=https://cdn.brand.org/logo.svg'] },
      { 'https://cdn.brand.org/logo.svg': LOGO },
    );
    const indicator = await resolver.resolve('brand.org');
    expect(indicator?.status).toBe('self-asserted');
    expect(indicator?.png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('looks no further when DMARC does not enforce', async () => {
    const { resolver, fetchBytes, resolveTxt } = setup(
      { '_dmarc.brand.org': ['v=DMARC1; p=none'], 'default._bimi.brand.org': ['v=BIMI1; l=https://cdn.brand.org/logo.svg'] },
      { 'https://cdn.brand.org/logo.svg': LOGO },
    );
    expect(await resolver.resolve('brand.org')).toBeNull();
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(resolveTxt).not.toHaveBeenCalledWith('default._bimi.brand.org');
  });

  it('falls back to the organizational domain for a subdomain', async () => {
    const { resolver, resolveTxt } = setup(
      { '_dmarc.brand.org': ['v=DMARC1; p=reject'], 'default._bimi.brand.org': ['v=BIMI1; l=https://cdn.brand.org/logo.svg'] },
      { 'https://cdn.brand.org/logo.svg': LOGO },
    );
    expect((await resolver.resolve('news.brand.org'))?.status).toBe('self-asserted');
    expect(resolveTxt).toHaveBeenCalledWith('default._bimi.news.brand.org');
  });

  it('shows the certificate\'s logo, not the l= one, when a valid VMC backs the record', async () => {
    const { resolver } = setup(
      { '_dmarc.brand.example': ['v=DMARC1; p=quarantine'], 'default._bimi.brand.example': ['v=BIMI1; l=https://cdn.brand.example/logo.svg; a=https://cdn.brand.example/vmc.pem'] },
      { 'https://cdn.brand.example/vmc.pem': `${fixture('leaf')}\n${fixture('intermediate')}` },
    );
    const indicator = await resolver.resolve('brand.example');
    expect(indicator?.status).toBe('verified');
    expect(indicator?.organization).toBe('Brand Example Ltd');
    // The certificate's logo is green (#0a6); the l= URL was never fetched.
    const sharp = (await import('sharp')).default;
    const { data } = await sharp(indicator!.png).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0x00, 0xaa, 0x66]);
  });

  it('refuses the logo when the certificate does not validate, even with a valid l=', async () => {
    const { resolver } = setup(
      { '_dmarc.brand.org': ['v=DMARC1; p=reject'], 'default._bimi.brand.org': ['v=BIMI1; l=https://cdn.brand.org/logo.svg; a=https://cdn.brand.org/vmc.pem'] },
      // The test leaf names brand.example, not brand.org.
      { 'https://cdn.brand.org/logo.svg': LOGO, 'https://cdn.brand.org/vmc.pem': `${fixture('leaf')}\n${fixture('intermediate')}` },
    );
    expect(await resolver.resolve('brand.org')).toBeNull();
  });

  it('caches per domain and shares a lookup between concurrent callers', async () => {
    const { resolver, resolveTxt } = setup(
      { '_dmarc.brand.org': ['v=DMARC1; p=reject'], 'default._bimi.brand.org': ['v=BIMI1; l=https://cdn.brand.org/logo.svg'] },
      { 'https://cdn.brand.org/logo.svg': LOGO },
    );
    await Promise.all([resolver.resolve('brand.org'), resolver.resolve('Brand.org.')]);
    await resolver.resolve('brand.org');
    expect(resolveTxt.mock.calls.filter(([name]) => name === '_dmarc.brand.org')).toHaveLength(1);
  });

  it('asks again soon after a DNS failure instead of hiding the logo for hours', async () => {
    const { resolver, resolveTxt, clock } = setup({});
    resolveTxt.mockRejectedValueOnce(dnsError('ESERVFAIL'));
    expect(await resolver.resolve('brand.org')).toBeNull();
    const calls = resolveTxt.mock.calls.length;
    await resolver.resolve('brand.org');
    expect(resolveTxt.mock.calls.length).toBe(calls);
    clock.now += 11 * 60 * 1000;
    await resolver.resolve('brand.org');
    expect(resolveTxt.mock.calls.length).toBeGreaterThan(calls);
  });

  it('refuses names it must not look up', async () => {
    const { resolver, resolveTxt } = setup({});
    for (const name of ['localhost', 'printer.local', 'nas.lan', 'x', '10.0.0.1.in-addr.arpa', 'a..b', 'brand.org/x']) {
      expect(normalizeBimiDomain(name)).toBeNull();
      expect(await resolver.resolve(name)).toBeNull();
    }
    expect(resolveTxt).not.toHaveBeenCalled();
  });
});
