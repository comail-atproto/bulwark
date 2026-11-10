import { describe, expect, it } from 'vitest';
import { brandIndicatorDomain, parseAuthenticationResults } from '@/lib/email-headers';

const message = (from: string, ...headers: string[]) => ({
  from: [{ email: from }],
  authenticationResults: headers.length ? parseAuthenticationResults(headers) : undefined,
});

describe('brandIndicatorDomain', () => {
  it('names the From domain of a message that passed DMARC for it', () => {
    const email = message('news@Brand.org', 'mx.example; dkim=pass header.d=brand.org; spf=pass smtp.mailfrom=bounce.brand.org; dmarc=pass header.from=brand.org');
    expect(brandIndicatorDomain(email)).toBe('brand.org');
  });

  it('needs a DMARC verdict, not only an aligned DKIM pass', () => {
    expect(brandIndicatorDomain(message('news@brand.org', 'mx.example; dkim=pass header.d=brand.org; spf=pass smtp.mailfrom=brand.org'))).toBeUndefined();
    expect(brandIndicatorDomain(message('news@brand.org', 'mx.example; dkim=pass header.d=brand.org; dmarc=none header.from=brand.org'))).toBeUndefined();
  });

  it('refuses a pass the server recorded for another header.from', () => {
    expect(brandIndicatorDomain(message('ceo@bank.com', 'mx.example; dkim=pass header.d=lookalike.com; dmarc=pass header.from=lookalike.com'))).toBeUndefined();
  });

  it('trusts only the receiving server\'s own header, the topmost', () => {
    const forged = message(
      'ceo@bank.com',
      'mx.example; spf=fail smtp.mailfrom=bank.com; dmarc=fail header.from=bank.com',
      'mx.example; dkim=pass header.d=bank.com; dmarc=pass header.from=bank.com',
    );
    expect(brandIndicatorDomain(forged)).toBeUndefined();
  });

  it('gives nothing without results or a From', () => {
    expect(brandIndicatorDomain(message('news@brand.org'))).toBeUndefined();
    expect(brandIndicatorDomain({ from: [], authenticationResults: parseAuthenticationResults('mx.example; dmarc=pass header.from=brand.org') })).toBeUndefined();
    expect(brandIndicatorDomain(undefined)).toBeUndefined();
  });
});
