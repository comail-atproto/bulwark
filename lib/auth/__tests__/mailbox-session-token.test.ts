import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signMailboxSessionToken } from '../mailbox-session';

const SECRET = 's'.repeat(32);

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('signMailboxSessionToken', () => {
  const previous = process.env.BULWARK_RELAY_SSO_SECRET;

  beforeEach(() => {
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.BULWARK_RELAY_SSO_SECRET;
    else process.env.BULWARK_RELAY_SSO_SECRET = previous;
  });

  it('fails closed without a strong secret or mailbox', () => {
    process.env.BULWARK_RELAY_SSO_SECRET = 'short';
    expect(signMailboxSessionToken('owner@comail.at')).toBeNull();
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
    expect(signMailboxSessionToken('')).toBeNull();
  });

  it('signs only the mailbox with the temporary compatibility audience', () => {
    const token = signMailboxSessionToken('owner@comail.at');
    expect(token).not.toBeNull();
    const [headerPart, payloadPart, signature] = token!.split('.');
    expect(decode(headerPart)).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    const payload = decode(payloadPart);
    expect(payload).toMatchObject({
      mailbox: 'owner@comail.at',
      iss: 'comail-bulwark',
      aud: 'comail-access-approvals',
    });
    expect(payload).not.toHaveProperty('did');
    expect(payload).not.toHaveProperty('appPassword');
    expect(signature).toBe(createHmac('sha256', SECRET).update(`${headerPart}.${payloadPart}`).digest('base64url'));
  });
});
