// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decryptSession, encryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';

vi.mock('@/lib/auth/session-secret', () => ({ getSessionSecret: () => 's'.repeat(64) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/telemetry/login-tracker', () => ({ recordLogin: vi.fn() }));
vi.mock('@/lib/wopi/revocation', () => ({ revokeWopiTokens: vi.fn() }));
vi.mock('@/lib/auth/verify-jmap-auth', () => ({
  JmapAuthVerificationError: class extends Error {},
  resolveJmapIdentity: async () => ({ serverUrl: 'https://mail.example', accountName: 'alice@example.test' }),
  normalizeJmapServerUrl: (url: string) => url,
  validateProxyAuthHeader: vi.fn(),
}));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: { ensureLoaded: async () => {}, get: (key: string, fallback: unknown) => key === 'jmapServerUrl' ? 'https://mail.example' : fallback },
}));
vi.mock('@/lib/stalwart/auth-context', () => ({
  setStalwartAuthContextInStore: vi.fn(), clearStalwartAuthContextInStore: vi.fn(),
  stalwartAuthContextCookieName: (slot: number) => `jmap_stalwart_ctx_${slot}`,
}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

import { DELETE, POST } from '@/app/api/auth/session/route';
import { POST as signIn } from '@/app/api/auth/relay/route';

const BRIDGE = 'https://inbox.internal/webmail/app-passwords';
const HEADERS = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const identity = { did: 'did:web:alice.example', credentialId: 'alice-session' };

function storeSession(slot: number, username = 'alice@example.test', credentialId = 'alice-session') {
  jar.set(sessionCookieName(slot), encryptSession('https://mail.example', username, 'password', { ...identity, credentialId }));
}

describe('Inbox session credential lifecycle', () => {
  beforeEach(() => {
    jar.clear();
    vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'k'.repeat(64));
    vi.stubEnv('INBOX_APP_PASSWORD_BRIDGE_URL', BRIDGE);
    vi.stubEnv('INBOX_SSO_REDEEM_URL', 'https://inbox.internal/webmail/sso/redeem');
    vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', 'https://mail.example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('keeps the credential ID inside the authenticated encrypted session', () => {
    storeSession(0);
    expect(decryptSession(jar.get(sessionCookieName(0))!)).toMatchObject(identity);
    expect(jar.get(sessionCookieName(0))).not.toContain(identity.credentialId);
  });

  it.each(['', '&local_only=true'])('releases only the signed-out slot, including hosted Inbox sign-out: %s', async (suffix) => {
    storeSession(0);
    storeSession(2, 'bob@example.test', 'bob-session');
    const response = await DELETE(new NextRequest(`https://mail.example/api/auth/session?slot=0${suffix}`, { method: 'DELETE', headers: HEADERS }));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${BRIDGE}/alice-session`, expect.objectContaining({ method: 'DELETE', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
    const assertion = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('authorization')!.split(' ')[1];
    expect(JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())).toMatchObject({ mailbox: 'alice@example.test', aud: 'comail-byomc-app-passwords' });
    expect(jar.has(sessionCookieName(0))).toBe(false);
    expect(jar.has(sessionCookieName(2))).toBe(true);
  });

  it('releases every owned browser credential when signing out of all accounts', async () => {
    storeSession(0);
    storeSession(2, 'bob@example.test', 'bob-session');
    await DELETE(new NextRequest('https://mail.example/api/auth/session?all=true', { method: 'DELETE', headers: HEADERS }));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url).sort()).toEqual([`${BRIDGE}/alice-session`, `${BRIDGE}/bob-session`]);
  });

  it('clears local credentials even if Inbox revocation is unavailable', async () => {
    storeSession(0);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('private upstream detail'));
    expect((await DELETE(new NextRequest('https://mail.example/api/auth/session', { method: 'DELETE', headers: HEADERS }))).status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(jar.has(sessionCookieName(0))).toBe(false);
    const { logger } = await import('@/lib/logger');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private upstream detail');
  });

  it('does not infer ownership or revoke legacy and ordinary password credentials', async () => {
    jar.set(sessionCookieName(0), encryptSession('https://mail.example', 'alice@example.test', 'password'));
    await DELETE(new NextRequest('https://mail.example/api/auth/session', { method: 'DELETE', headers: HEADERS }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin sign-out before credential revocation', async () => {
    storeSession(0);
    expect((await DELETE(new NextRequest('https://mail.example/api/auth/session', { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(jar.has(sessionCookieName(0))).toBe(true);
  });

  it('retains credential ownership when the same session is remembered again', async () => {
    storeSession(0);
    const response = await POST(new NextRequest('https://mail.example/api/auth/session', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ serverUrl: 'https://mail.example', username: 'alice@example.test', password: 'password' }),
    }));
    expect(response.status).toBe(200);
    expect(decryptSession(jar.get(sessionCookieName(0))!)).toMatchObject(identity);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('repeated sign-in and hosted sign-out reclaim capacity without touching other credentials', async () => {
    const credentials = new Set(['another-device', 'mail-client', 'service']);
    let issued = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        expect(credentials.delete(String(input).slice(BRIDGE.length + 1))).toBe(true);
        return new Response(null, { status: 204 });
      }
      if (credentials.size >= 5) return new Response('credential capacity reached', { status: 429 });
      const id = `browser-${++issued}`;
      credentials.add(id);
      return Response.json({ did: 'did:web:alice.example', mailbox: 'alice@example.test', app_password: `secret-${id}`, credential_id: id, groupware_enabled: false, builders_enabled: false });
    }));
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await signIn(new NextRequest('https://mail.example/api/auth/relay', {
        method: 'POST', headers: { origin: 'https://mail.example', 'content-type': 'application/x-www-form-urlencoded' },
        body: `code=${'c'.repeat(64)}`,
      }));
      expect(response.status).toBe(303);
      expect(credentials.size).toBe(4);
      expect((await DELETE(new NextRequest('https://mail.example/api/auth/session?local_only=true', { method: 'DELETE', headers: HEADERS }))).status).toBe(200);
      expect([...credentials]).toEqual(['another-device', 'mail-client', 'service']);
    }
    expect(issued).toBe(12);
  });
});
