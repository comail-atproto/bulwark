// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string }>(),
  options: new Map<string, Record<string, unknown>>(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => state.jar.get(name),
  set: (name: string, value: string, options: Record<string, unknown>) => {
    state.jar.set(name, { value }); state.options.set(name, options);
  },
  delete: (name: string) => { state.jar.delete(name); },
}) }));
vi.mock('@/lib/admin/config-manager', () => ({ configManager: {
  ensureLoaded: async () => undefined,
  get: (key: string, fallback: unknown) => key === 'jmapServerUrl' ? 'https://mail.example.test' : key === 'calendarEnabled' ? true : fallback,
  getPolicy: () => ({}),
} }));
vi.mock('@/lib/telemetry/login-tracker', () => ({ recordLogin: async () => undefined }));

import { POST as relay } from '@/app/api/auth/relay/route';
import { GET, PUT, DELETE } from '@/app/api/auth/session/route';
import { decryptSession, encryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { readStalwartAuthContextFromStore } from '@/lib/stalwart/auth-context';
import { groupwareAllowed } from '@/lib/groupware/access';

const ORIGIN = 'https://mail.example.test';
const alice = { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', mailbox: 'alice@example.test', app_password: 'synthetic-alice', credential_id: 'alice-one', groupware_enabled: true, builders_enabled: false };
const bob = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', mailbox: 'bob@example.test', app_password: 'synthetic-bob', credential_id: 'bob-one', groupware_enabled: false, builders_enabled: true };
type Identity = typeof alice;

let server: Server;
let sharedSecret: string;
let base: string;
const codes = new Map<string, Identity>();
const revoked: string[] = [];
const disabled = new Set<string>();
const serverErrors: string[] = [];

function request(route: string, method: string, body?: string) {
  return new NextRequest(`${ORIGIN}${route}`, { method, headers: {
    origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
    ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
  }, ...(body ? { body } : {}) });
}

async function login(identity: Identity) {
  const code = randomBytes(32).toString('hex'); codes.set(code, identity);
  return relay(request('/api/auth/relay', 'POST', `code=${code}`));
}

function credentials(identity: Identity, slot: number) {
  return { slot, serverUrl: ORIGIN, username: identity.mailbox, accountName: identity.mailbox, hasSessionCookie: true, trusted: true, authHeader: `Basic ${Buffer.from(`${identity.mailbox}:${identity.app_password}`).toString('base64')}` };
}

function resourceRequest() {
  const req = request('/api/calendar', 'GET');
  for (const [name, { value }] of state.jar) req.cookies.set(name, value);
  return req;
}

beforeEach(async () => {
  state.jar.clear(); state.options.clear(); codes.clear(); revoked.length = 0; disabled.clear(); serverErrors.length = 0;
  sharedSecret = randomBytes(32).toString('hex');
  vi.stubEnv('SESSION_SECRET', randomBytes(32).toString('hex'));
  vi.stubEnv('BULWARK_INBOX_SSO_SECRET', sharedSecret);
  vi.stubEnv('INBOX_SSO_PUBLIC_ORIGIN', ORIGIN);
  server = createServer(async (req, res) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const [header, payload, signature] = token.split('.');
      expect(signature).toBe(createHmac('sha256', sharedSecret).update(`${header}.${payload}`).digest('base64url'));
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      expect(claims.iss).toBe('comail-bulwark');
      expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
      let value: unknown;
      if (req.url === '/webmail/sso/redeem') {
        expect(req.method).toBe('POST'); expect(claims.aud).toBe('comail-relay-sso-redeem');
        let body = ''; for await (const chunk of req) body += chunk;
        const { code } = JSON.parse(body);
        expect(claims.code_hash).toBe(createHash('sha256').update(code).digest('hex'));
        value = codes.get(code); codes.delete(code);
        if (!value) { res.writeHead(410).end(); return; }
      } else if (req.url === '/webmail/session') {
        expect(req.method).toBe('GET'); expect(claims.aud).toBe('comail-access-approvals');
        const identity = [alice, bob].find(x => x.mailbox === claims.mailbox);
        if (!identity) { res.writeHead(404).end(); return; }
        value = { did: identity.did, groupware_enabled: identity.groupware_enabled && !disabled.has(identity.mailbox) };
      } else {
        expect(req.method).toBe('DELETE'); expect(claims.aud).toBe('comail-byomc-app-passwords');
        const id = req.url?.split('/').pop() ?? '';
        expect(id.startsWith(claims.mailbox.split('@')[0])).toBe(true);
        revoked.push(id); res.writeHead(204).end(); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    } catch (error) { serverErrors.push(String(error)); res.writeHead(500).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  base = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('INBOX_SSO_REDEEM_URL', `${base}/webmail/sso/redeem`);
  vi.stubEnv('INBOX_MAILBOX_SESSION_URL', `${base}/webmail/session`);
  vi.stubEnv('INBOX_APP_PASSWORD_BRIDGE_URL', `${base}/webmail/app-passwords`);
});

afterEach(async () => {
  server.closeAllConnections(); server.close(); await once(server, 'close');
  vi.unstubAllEnvs(); expect(serverErrors).toEqual([]);
});

describe('Comail authentication on a stock baseline', () => {
  it('restores separate identities, permissions and credentials through real encryption', async () => {
    expect((await login(alice)).headers.get('location')).toBe('/?sso_slot=0');
    expect((await login(bob)).headers.get('location')).toBe('/?sso_slot=1');
    for (const [slot, identity] of [alice, bob].entries()) {
      const response = await PUT(request(`/api/auth/session?slot=${slot}`, 'PUT'));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ username: identity.mailbox, password: identity.app_password, did: identity.did, credentialId: identity.credential_id, groupwareEnabled: identity.groupware_enabled, buildersEnabled: identity.builders_enabled, signedInAt: expect.any(Number) });
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(state.options.get(sessionCookieName(slot))).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
      const context = readStalwartAuthContextFromStore({ get: (name: string) => state.jar.get(name) } as never, slot);
      expect(context).toEqual({ serverUrl: ORIGIN, username: identity.mailbox, authHeader: credentials(identity, slot).authHeader });
      const summary = await GET(request(`/api/auth/session?slot=${slot}`, 'GET'));
      expect(await summary.json()).not.toHaveProperty('password');
    }
  });

  it('denies another slot, another credential and a withdrawn entitlement', async () => {
    await login(alice); await login(bob);
    expect(await groupwareAllowed(resourceRequest(), credentials(alice, 0), 'calendar')).toBe(true);
    expect(await groupwareAllowed(resourceRequest(), credentials(bob, 1), 'calendar')).toBe(false);
    expect(await groupwareAllowed(resourceRequest(), credentials(alice, 1), 'calendar')).toBe(false);
    expect(await groupwareAllowed(resourceRequest(), { ...credentials(alice, 0), authHeader: credentials(bob, 1).authHeader }, 'calendar')).toBe(false);
    disabled.add(alice.mailbox);
    expect(await groupwareAllowed(resourceRequest(), credentials(alice, 0), 'calendar')).toBe(false);
  });

  it('replaces only the matching slot and revokes its previous credential', async () => {
    await login(alice); await login(bob);
    const untouched = state.jar.get(sessionCookieName(1))?.value;
    expect((await login({ ...alice, credential_id: 'alice-two', app_password: 'synthetic-new-alice' })).headers.get('location')).toBe('/?sso_slot=0');
    expect(revoked).toEqual(['alice-one']);
    expect(state.jar.get(sessionCookieName(1))?.value).toBe(untouched);
    expect(decryptSession(state.jar.get(sessionCookieName(0))!.value)).toMatchObject({ password: 'synthetic-new-alice', credentialId: 'alice-two' });
  });

  it('signs one account out locally, revokes its credential and keeps the other usable', async () => {
    await login(alice); await login(bob);
    const response = await DELETE(request('/api/auth/session?slot=0&local_only=true', 'DELETE'));
    expect(await response.json()).toEqual({ ok: true, did: alice.did });
    expect(revoked).toEqual(['alice-one']);
    expect(state.jar.has(sessionCookieName(0))).toBe(false);
    expect((await PUT(request('/api/auth/session?slot=0', 'PUT'))).status).toBe(401);
    expect(await (await PUT(request('/api/auth/session?slot=1', 'PUT'))).json()).toMatchObject({ did: bob.did, password: bob.app_password });
    expect((await DELETE(request('/api/auth/session?all=true', 'DELETE'))).status).toBe(200);
    expect(revoked).toEqual(['alice-one', 'bob-one']);
    expect(state.jar.has(sessionCookieName(1))).toBe(false);
  });

  it('backfills an old session from its authenticated mailbox without resetting its age', async () => {
    const signedInAt = Date.now() - 60_000;
    state.jar.set(sessionCookieName(0), { value: encryptSession(ORIGIN, alice.mailbox, alice.app_password, signedInAt) });
    const response = await PUT(request('/api/auth/session', 'PUT'));
    expect(await response.json()).toMatchObject({ did: alice.did, signedInAt });
    expect(decryptSession(state.jar.get(sessionCookieName(0))!.value)).toMatchObject({ did: alice.did, signedInAt });
  });
});
