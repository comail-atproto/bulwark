import { describe, expect, it, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  ImpersonationJwtError,
  verifyImpersonationJwt,
  impersonationReplayCache,
} from '@/lib/impersonation/jwt';

const SECRET = 'a'.repeat(64);
const ISSUER = 'platform-api/webmail';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sign(payload: Record<string, unknown>, secret: string = SECRET, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }): string {
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${base64Url(sig)}`;
}

function basePayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    iat: now,
    exp: now + 120,
    jti: 'jti-' + Math.random().toString(36).slice(2),
    mailbox: 'alice@example.test',
    ...overrides,
  };
}

describe('verifyImpersonationJwt', () => {
  beforeEach(() => {
    impersonationReplayCache.clear();
  });

  it('accepts a valid HS256 token', () => {
    const token = sign(basePayload());
    const claims = verifyImpersonationJwt(token, SECRET, { expectedIssuer: ISSUER });
    expect(claims.mailbox).toBe('alice@example.test');
  });

  it('rejects non-HS256 algorithms', () => {
    const header = { alg: 'none', typ: 'JWT' };
    const h = base64Url(JSON.stringify(header));
    const p = base64Url(JSON.stringify(basePayload()));
    const token = `${h}.${p}.`;
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrow(ImpersonationJwtError);
  });

  it('rejects tokens with a forged signature', () => {
    const token = sign(basePayload(), 'a-different-secret-that-is-also-long-enough-32');
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrowError(/signature/i);
  });

  it('rejects when secret is too short', () => {
    const token = sign(basePayload());
    expect(() => verifyImpersonationJwt(token, 'short')).toThrowError(/32 characters/);
  });

  it('rejects expired tokens', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(basePayload({ iat: now - 600, exp: now - 300 }));
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrowError(/expired/i);
  });

  it('rejects tokens with lifetime over the 300s ceiling', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(basePayload({ iat: now, exp: now + 3600 }));
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrowError(/lifetime/i);
  });

  it('rejects tokens with iss mismatch when expectedIssuer is set', () => {
    const token = sign(basePayload({ iss: 'someone-else' }));
    expect(() =>
      verifyImpersonationJwt(token, SECRET, { expectedIssuer: ISSUER }),
    ).toThrowError(/issuer/i);
  });

  it("rejects mailbox containing '%'", () => {
    const token = sign(basePayload({ mailbox: 'a%b@example.test' }));
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrowError(/'%'/);
  });

  it("rejects mailbox containing ':'", () => {
    const token = sign(basePayload({ mailbox: 'a:b@example.test' }));
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrowError(/':'/);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyImpersonationJwt('not.a.jwt.extra', SECRET)).toThrow();
    expect(() => verifyImpersonationJwt('', SECRET)).toThrow();
  });

  it('honours nbf with skew', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(basePayload({ nbf: now + 600 }));
    expect(() => verifyImpersonationJwt(token, SECRET)).toThrowError(/not yet valid/i);
  });
});

describe('impersonationReplayCache', () => {
  beforeEach(() => {
    impersonationReplayCache.clear();
  });

  it('accepts a jti once and rejects it on second use', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(impersonationReplayCache.consume('jti-1', now + 60, now)).toBe(true);
    expect(impersonationReplayCache.consume('jti-1', now + 60, now)).toBe(false);
  });

  it('prunes expired jtis on next consume', () => {
    const now = Math.floor(Date.now() / 1000);
    impersonationReplayCache.consume('jti-old', now - 600, now - 600);
    // Far in the future - pruning should clear the old entry.
    expect(impersonationReplayCache.consume('jti-new', now + 60, now + 1000)).toBe(true);
    // Re-using the old jti is allowed after pruning (security irrelevant since
    // the token would fail signature/exp validation upstream).
    expect(impersonationReplayCache.consume('jti-old', now + 60, now + 1000)).toBe(true);
  });
});
