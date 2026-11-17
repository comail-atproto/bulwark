import { describe, expect, it } from 'vitest';
import { emailIframeCsp } from '@/lib/email-sanitization';

describe('emailIframeCsp app fonts', () => {
  it('allows only data: fonts by default while remote content is blocked', () => {
    expect(emailIframeCsp(true)).toContain('font-src data:;');
  });

  it('adds the folder of the bundled app font, not the whole origin', () => {
    const csp = emailIframeCsp(true, ['https://mail.example/_next/static/media/']);
    expect(csp).toContain('font-src data: https://mail.example/_next/static/media/;');
    expect(csp).not.toContain("'self'");
  });

  it('drops anything that is not a folder URL', () => {
    const csp = emailIframeCsp(false, ['https://mail.example/', "https://x/; script-src 'unsafe-inline'", 'https://mail.example/a.woff2', 'javascript:x/']);
    expect(csp).toContain('font-src data: https://mail.example/ http: https:;');
    expect(csp).not.toContain('script-src');
  });
});
