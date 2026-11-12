import { describe, expect, it } from 'vitest';
import { dmarcAllowsBimi, pickBimiRecord, pickDmarcRecord, type DmarcRecord } from '@/lib/bimi/records';

describe('pickBimiRecord', () => {
  it('reads the logo and certificate locations', () => {
    expect(pickBimiRecord(['v=BIMI1; l=https://brand.example/logo.svg; a=https://brand.example/vmc.pem;'])).toEqual({
      logoUrl: 'https://brand.example/logo.svg',
      evidenceUrl: 'https://brand.example/vmc.pem',
      declined: false,
    });
  });

  it('ignores the SPF record a wildcard TXT answers with', () => {
    // netflix.com and coinbase.com answer default._bimi queries this way.
    expect(pickBimiRecord(['v=spf1 include:_spf.example.com -all'])).toBeNull();
    expect(pickBimiRecord(['v=spf1 -all', 'v=BIMI1;l=https://brand.example/logo.svg'])?.logoUrl).toBe('https://brand.example/logo.svg');
  });

  it('refuses two assertion records', () => {
    expect(pickBimiRecord(['v=BIMI1; l=https://a.example/1.svg', 'v=BIMI1; l=https://a.example/2.svg'])).toBeNull();
  });

  it('treats empty l= and a= as declining', () => {
    expect(pickBimiRecord(['v=BIMI1; l=; a=;'])?.declined).toBe(true);
    // uber.com: a logo, an empty a=.
    expect(pickBimiRecord(['v=BIMI1; l=https://brand.example/logo.svg; a='])).toEqual({
      logoUrl: 'https://brand.example/logo.svg', evidenceUrl: undefined, declined: false,
    });
  });

  it('refuses locations that are not https', () => {
    expect(pickBimiRecord(['v=BIMI1; l=http://brand.example/logo.svg'])).toBeNull();
    expect(pickBimiRecord(['v=BIMI1; l=https://brand.example/logo.svg; a=ftp://brand.example/vmc.pem'])).toBeNull();
  });
});

describe('pickDmarcRecord', () => {
  it('reads p, sp and pct', () => {
    expect(pickDmarcRecord(['v=DMARC1; p=quarantine; sp=reject; pct=100; rua=mailto:d@example.com'])).toEqual({ p: 'quarantine', sp: 'reject', pct: 100 });
    expect(pickDmarcRecord(['v=DMARC1;p=reject'])).toEqual({ p: 'reject', sp: undefined, pct: 100 });
  });

  it('refuses a record without a valid p', () => {
    expect(pickDmarcRecord(['v=DMARC1; rua=mailto:d@example.com'])).toBeNull();
    expect(pickDmarcRecord(['v=spf1 -all'])).toBeNull();
  });
});

describe('dmarcAllowsBimi', () => {
  const reject: DmarcRecord = { p: 'reject', pct: 100 };
  const quarantine: DmarcRecord = { p: 'quarantine', pct: 100 };
  const none: DmarcRecord = { p: 'none', pct: 100 };

  it('needs quarantine or reject for every message', () => {
    expect(dmarcAllowsBimi(reject, reject, false)).toBe(true);
    expect(dmarcAllowsBimi(quarantine, quarantine, false)).toBe(true);
    expect(dmarcAllowsBimi(none, none, false)).toBe(false);
    expect(dmarcAllowsBimi({ p: 'reject', pct: 50 }, null, false)).toBe(false);
    expect(dmarcAllowsBimi(null, null, false)).toBe(false);
  });

  it('applies the organizational domain\'s sp to a subdomain without its own record', () => {
    expect(dmarcAllowsBimi(null, { p: 'reject', sp: 'none', pct: 100 }, true)).toBe(false);
    expect(dmarcAllowsBimi(null, { p: 'quarantine', sp: 'reject', pct: 100 }, true)).toBe(true);
    expect(dmarcAllowsBimi(null, reject, true)).toBe(true);
  });

  it('refuses a subdomain whose organizational domain is p=none, whatever the subdomain says', () => {
    expect(dmarcAllowsBimi(reject, none, true)).toBe(false);
  });
});
