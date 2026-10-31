import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { signBridgeToken } from '../relay-bridge';

const SECRET = 's'.repeat(32); // 32 bytes

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('signBridgeToken', () => {
  const prev = process.env.BULWARK_RELAY_SSO_SECRET;
  beforeEach(() => {
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.BULWARK_RELAY_SSO_SECRET;
    else process.env.BULWARK_RELAY_SSO_SECRET = prev;
  });

  it('returns null when the secret is missing or too short', () => {
    delete process.env.BULWARK_RELAY_SSO_SECRET;
    expect(signBridgeToken('a@comail.at')).toBeNull();
    process.env.BULWARK_RELAY_SSO_SECRET = 'short';
    expect(signBridgeToken('a@comail.at')).toBeNull();
  });

  it('returns null for an empty mailbox', () => {
    expect(signBridgeToken('')).toBeNull();
  });

  it('mints an HS256 token asserting the mailbox with the bridge audience/issuer', () => {
    const tok = signBridgeToken('owner@comail.at');
    expect(tok).not.toBeNull();
    const [h, p, sig] = tok!.split('.');
    expect(h && p && sig).toBeTruthy();

    const header = decodePart(h);
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');

    const payload = decodePart(p);
    expect(payload.mailbox).toBe('owner@comail.at');
    expect(payload.aud).toBe('comail-byomc-app-passwords'); // MUST match the relay verifier
    expect(payload.iss).toBe('comail-bulwark');
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp as number).toBeGreaterThan(now);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(300);
    expect(typeof payload.jti).toBe('string');

    // Signature verifies with the shared secret (proves the relay would accept it).
    const expected = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
    expect(sig).toBe(expected);
  });
});
