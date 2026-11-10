// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { parseCrl, sanMatches, validateMarkCertificate, type CertificateOptions } from '@/lib/bimi/certificate';
import { bimiRoots } from '@/lib/bimi/roots';

// The test PKI comes from fixtures/bimi/generate.py; cnn-vmc.pem is a real VMC.
const dir = path.join(__dirname, 'fixtures', 'bimi');
const pem = (name: string) => readFileSync(path.join(dir, `${name}.pem`), 'utf8');
const root = new X509Certificate(pem('root'));
const otherRoot = new X509Certificate(pem('other-root'));
const intermediate = new X509Certificate(pem('intermediate'));
const crlDer = (() => {
  const text = pem('intermediate.crl');
  return new Uint8Array(Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'));
})();

const NOW = Date.UTC(2026, 9, 29);
const base: CertificateOptions = { domains: ['brand.example'], selector: 'default', roots: [root], now: NOW };
/** The leaf followed by its intermediate, as a sender's PEM file has them. */
const bundle = (leaf: string) => `${pem(leaf)}\n${pem('intermediate')}`;

describe('validateMarkCertificate', () => {
  it('accepts a VMC chaining to a pinned root and returns the logo inside it', async () => {
    const result = await validateMarkCertificate(bundle('leaf'), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mark.svg).toContain('<title>Brand Example</title>');
    expect(result.mark.markType).toBe('verified');
    expect(result.mark.organization).toBe('Brand Example Ltd');
    expect(result.mark.issuer).toBe('Test Mark Authority');
  });

  it('tells a CMC (prior use mark) from a VMC', async () => {
    const result = await validateMarkCertificate(bundle('leaf-cmc'), base);
    expect(result.ok && result.mark.markType).toBe('common');
  });

  it('refuses a chain whose root is not pinned, even when the PEM carries that root', async () => {
    const result = await validateMarkCertificate(`${pem('leaf-other')}\n${pem('other-root')}`, base);
    expect(result).toEqual({ ok: false, reason: 'chain does not reach a trusted root' });
    // The same chain passes once its root is trusted, so the refusal is about the root.
    expect((await validateMarkCertificate(pem('leaf-other'), { ...base, roots: [otherRoot] })).ok).toBe(true);
  });

  it('refuses a chain that leaves out the intermediate', async () => {
    expect((await validateMarkCertificate(pem('leaf'), base)).ok).toBe(false);
  });

  it('refuses another domain', async () => {
    const result = await validateMarkCertificate(bundle('leaf'), { ...base, domains: ['brand-example.com'] });
    expect(result).toEqual({ ok: false, reason: 'domain not in certificate' });
  });

  it('refuses an expired certificate', async () => {
    const result = await validateMarkCertificate(bundle('leaf-expired'), base);
    expect(result).toEqual({ ok: false, reason: 'certificate outside its validity period' });
  });

  it('refuses a certificate without the BIMI key purpose', async () => {
    expect((await validateMarkCertificate(bundle('leaf-server'), base)).ok).toBe(false);
  });

  it('refuses a certificate without SCTs', async () => {
    const result = await validateMarkCertificate(bundle('leaf-no-sct'), base);
    expect(result).toEqual({ ok: false, reason: 'not logged to certificate transparency' });
  });

  it('refuses a certificate without a logo', async () => {
    const result = await validateMarkCertificate(bundle('leaf-no-logo'), base);
    expect(result).toEqual({ ok: false, reason: 'no logo in certificate' });
  });

  it('refuses a certificate its CA revoked, and asks the URL in the certificate', async () => {
    const fetchCrl = vi.fn(async () => crlDer);
    const revoked = await validateMarkCertificate(bundle('leaf-revoked'), { ...base, fetchCrl });
    expect(revoked).toEqual({ ok: false, reason: 'certificate revoked' });
    expect(fetchCrl).toHaveBeenCalledWith('http://crl.brand-ca.test/vmc.crl');
    expect((await validateMarkCertificate(bundle('leaf'), { ...base, fetchCrl })).ok).toBe(true);
  });

  it('accepts the certificate when the CRL cannot be fetched', async () => {
    const result = await validateMarkCertificate(bundle('leaf-revoked'), { ...base, fetchCrl: async () => null });
    expect(result.ok).toBe(true);
  });

  it('ignores a CRL that the issuer did not sign', async () => {
    // A CRL listing the leaf, but checked against the wrong key, proves nothing.
    expect(parseCrl(crlDer, intermediate)?.revoked.has('BADC0DE')).toBe(true);
    expect(parseCrl(crlDer, root)).toBeNull();
  });

  it('accepts a SAN that pins the selector', async () => {
    const options = { ...base, selector: 'brand' };
    expect((await validateMarkCertificate(bundle('leaf-selector'), options)).ok).toBe(true);
    expect((await validateMarkCertificate(bundle('leaf-selector'), base)).ok).toBe(false);
  });

  it('accepts CNN\'s real VMC from DigiCert with the shipped roots', async () => {
    const result = await validateMarkCertificate(pem('cnn-vmc'), { domains: ['cnn.com'], selector: 'default', roots: bimiRoots(), now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mark.organization).toBe('Cable News Network, Inc.');
    expect(result.mark.issuer).toBe('DigiCert, Inc.');
    expect(result.mark.svg).toMatch(/<svg/);
  });
});

describe('sanMatches', () => {
  it('matches the domain set for the default selector and the selector set otherwise', () => {
    expect(sanMatches(['brand.example'], ['brand.example'], 'default')).toBe(true);
    expect(sanMatches(['sel._bimi.brand.example'], ['brand.example'], 'sel')).toBe(true);
    expect(sanMatches(['sel._bimi.brand.example'], ['brand.example'], 'default')).toBe(false);
    expect(sanMatches(['other.example'], ['brand.example'], 'default')).toBe(false);
  });
});

describe('bimiRoots', () => {
  it('parses every pinned root', () => {
    const names = bimiRoots().map((cert) => /CN=([^\n]+)/.exec(cert.subject)?.[1]);
    expect(names).toEqual([
      'DigiCert Verified Mark Root CA',
      'GlobalSign Verified Mark Root R42',
      'SSL.com VMC RSA Root CA 2024',
      'SSL.com VMC ECC Root CA 2024',
    ]);
  });
});
