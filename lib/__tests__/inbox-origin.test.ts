import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboxBrowserOrigin } from '@/lib/auth/inbox-config';

describe('Inbox browser origin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the public origin configured for the existing Inbox login', () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://inbox.test/');
    expect(inboxBrowserOrigin('http://127.0.0.1:3000')).toBe('https://inbox.test');
  });

  it('accepts the historical setting and fails closed when settings disagree', () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', undefined);
    vi.stubEnv('RELAY_SSO_PUBLIC_ORIGIN', 'https://inbox.test');
    expect(inboxBrowserOrigin('http://127.0.0.1:3000')).toBe('https://inbox.test');
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://other.test');
    expect(inboxBrowserOrigin('http://127.0.0.1:3000')).toBeNull();
  });

  it.each(['', 'not-a-url', 'http://inbox.test', 'https://user:password@inbox.test',
    'https://inbox.test/path', 'https://inbox.test?query', 'https://inbox.test#fragment',
    'https://inbox.test\n'])('rejects invalid public origin %j', value => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', value);
    expect(inboxBrowserOrigin('https://inbox.test')).toBeNull();
  });

  it('keeps direct HTTPS and loopback development requests usable without configuration', () => {
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', undefined);
    vi.stubEnv('RELAY_SSO_PUBLIC_ORIGIN', undefined);
    expect(inboxBrowserOrigin('https://inbox.test')).toBe('https://inbox.test');
    expect(inboxBrowserOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(inboxBrowserOrigin('http://[::1]:3000')).toBe('http://[::1]:3000');
  });
});
