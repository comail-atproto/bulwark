import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailboxSessionURL, signMailboxSessionToken } from '@/lib/auth/mailbox-session';

const SECRET = 's'.repeat(32);
function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

afterEach(() => vi.unstubAllEnvs());

describe('mailbox session bridge', () => {
  it('uses the exact new session endpoint before the legacy identity bridge', () => {
    vi.stubEnv('INBOX_MAILBOX_SESSION_URL', 'https://inbox.internal.example/webmail/session');
    vi.stubEnv('INBOX_ACCESS_APPROVAL_BRIDGE_URL', 'https://inbox.internal.example/webmail/access-approvals');

    expect(mailboxSessionURL()).toBe('https://inbox.internal.example/webmail/session');
  });

  it('adds the identity path to the old bridge base', () => {
    vi.stubEnv('INBOX_ACCESS_APPROVAL_BRIDGE_URL', 'https://inbox.internal.example/webmail/access-approvals');

    expect(mailboxSessionURL()).toBe('https://inbox.internal.example/webmail/access-approvals/identity');
  });

  it('uses the released Relay setting when the Inbox setting is absent', () => {
    vi.stubEnv('RELAY_ACCESS_APPROVAL_BRIDGE_URL', 'https://relay.internal.example/webmail/access-approvals');

    expect(mailboxSessionURL()).toBe('https://relay.internal.example/webmail/access-approvals/identity');
  });

  it.each([
    'https://inbox.internal.example/webmail/session/',
    'https://inbox.internal.example/webmail/identity',
    'https://inbox.internal.example/webmail/session?debug=1',
  ])('fails closed when the new endpoint is not exactly /webmail/session: %s', (url) => {
    vi.stubEnv('INBOX_MAILBOX_SESSION_URL', url);

    expect(mailboxSessionURL()).toBe('');
  });

  it('keeps the short-lived legacy-audience mailbox assertion for released Inbox builds', () => {
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', SECRET);
    const token = signMailboxSessionToken('owner@comail.at');

    expect(token).not.toBeNull();
    const [, payloadPart] = token!.split('.');
    const payload = decode(payloadPart);
    expect(payload).toMatchObject({
      mailbox: 'owner@comail.at',
      iss: 'comail-bulwark',
      aud: 'comail-access-approvals',
    });
    expect(payload).not.toHaveProperty('did');
    expect(payload).not.toHaveProperty('appPassword');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(120);
  });
});
