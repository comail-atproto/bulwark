// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decryptSession, encryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';

vi.mock('@/lib/auth/session-secret', () => ({ getSessionSecret: () => 's'.repeat(64) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/access-approval/relay-bridge', () => ({
  backfillSessionIdentity: async (credentials: object) => ({ ...credentials, did: 'did:web:alice.example' }),
}));
vi.mock('@/lib/stalwart/auth-context', () => ({
  setStalwartAuthContextInStore: vi.fn(), clearStalwartAuthContextInStore: vi.fn(),
}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));

it.each(['app-password', { token: 'access-token' }])('keeps account credentials and feature flags when backfilling a session identity: %j', async (secret) => {
  const name = sessionCookieName(2);
  jar.set(name, encryptSession('https://mail.example', 'alice@example', secret, {
    groupwareEnabled: false, buildersEnabled: true,
  }));
  const { PUT } = await import('@/app/api/auth/session/route');
  const response = await PUT(new NextRequest('https://inbox.example/api/auth/session?slot=2', {
    method: 'PUT', headers: {
      'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
    },
  }));
  expect(response.status).toBe(200);
  expect(decryptSession(jar.get(name)!)).toMatchObject({
    did: 'did:web:alice.example', groupwareEnabled: false, buildersEnabled: true,
    ...(typeof secret === 'string' ? { password: secret } : secret),
  });
});
