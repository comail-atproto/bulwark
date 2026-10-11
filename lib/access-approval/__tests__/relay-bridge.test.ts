import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessApprovalBridgeToken } from '../relay-bridge';

const SECRET = '0123456789abcdef0123456789abcdef';

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('signAccessApprovalBridgeToken', () => {
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
    expect(signAccessApprovalBridgeToken('owner@comail.at')).toBeNull();
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
    expect(signAccessApprovalBridgeToken('')).toBeNull();
  });

  it('signs only the mailbox with the distinct approval audience', () => {
    const token = signAccessApprovalBridgeToken('owner@comail.at');
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
