import { describe, expect, it, vi } from 'vitest';
import { encryptSession, decryptSession } from '../auth/crypto';

vi.mock('@/lib/auth/session-secret', () => ({
  getSessionSecret: () => 'x'.repeat(32),
  hasSessionSecret: () => true,
}));

describe('Comail authenticated session claims', () => {
  it('round-trips token credentials with the account identity and feature flags', () => {
    const token = encryptSession('https://mail.example.com', 'alice', { token: 'access-token' }, {
      did: 'did:web:alice.example', groupwareEnabled: false, buildersEnabled: true, signedInAt: 12345,
    });
    expect(decryptSession(token)).toEqual({
      serverUrl: 'https://mail.example.com', username: 'alice', token: 'access-token',
      did: 'did:web:alice.example', groupwareEnabled: false, buildersEnabled: true, signedInAt: 12345,
    });
  });

  it('keeps feature flags inside each authenticated session', () => {
    const token = encryptSession('https://inbox.example', 'alice', 'password', { groupwareEnabled: false, buildersEnabled: true });
    expect(decryptSession(token)).toMatchObject({ groupwareEnabled: false, buildersEnabled: true });
  });

  it('round-trips the optional verified atproto DID', () => {
    const token = encryptSession(
      'https://mail.example.com',
      'alice',
      's3cret',
      { did: 'did:plc:abc123' },
    );

    expect(decryptSession(token)).toEqual({
      serverUrl: 'https://mail.example.com',
      username: 'alice',
      password: 's3cret',
      did: 'did:plc:abc123',
      signedInAt: expect.any(Number),
    });
  });
});
