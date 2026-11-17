// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { encryptSession } from '@/lib/auth/crypto';

const access = vi.hoisted(() => new Map<string, boolean>());
vi.mock('@/lib/groupware/access', () => ({ currentGroupwareEnabled: vi.fn(async (username: string) => access.get(username) === true) }));

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'comail-auth-config-'));
  vi.stubEnv('ADMIN_CONFIG_DIR', directory);
  vi.stubEnv('ADMIN_STATE_DIR', join(directory, 'state'));
  vi.stubEnv('APP_NAME', 'Comail');
  vi.stubEnv('ATPROTO_LOGIN_URL', 'https://mail.example.test/webmail/login');
  vi.stubEnv('HOSTED_INBOX_LOGOUT_DESTINATION', 'https://example.test/?signed_out=1');
  vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret'.repeat(3));
  vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'synthetic-bridge-secret'.repeat(3));
  vi.stubEnv('INBOX_CALENDAR_BRIDGE_URL', 'https://inbox.example.test/webmail/calendar/api/v1');
  vi.stubEnv('INBOX_CONTACTS_BRIDGE_URL', 'https://inbox.example.test/webmail/contacts/api/v1');
  vi.stubEnv('INBOX_FILES_BRIDGE_URL', 'https://inbox.example.test/webmail/files/api/v1');
  for (const key of ['CALENDAR_ENABLED', 'CONTACTS_ENABLED', 'FILES_ENABLED', 'APPS_ENABLED']) vi.stubEnv(key, 'true');
});

it('serves private capabilities only for the selected session and rechecks live access', async () => {
  const { GET } = await import('@/app/api/config/route');
  const cookies = ['alice', 'bob'].map((name, slot) => `${slot ? 'jmap_session_1' : 'jmap_session'}=${encryptSession(
    'https://mail.example.test', `${name}@example.test`, 'unused',
    { did: `did:plc:${name}`, groupwareEnabled: true },
  )}`).join('; ');
  const read = async (slot: number) => (await GET(new NextRequest('https://mail.example.test/api/config', {
    headers: { cookie: cookies, 'X-JMAP-Cookie-Slot': String(slot) },
  }))).json();
  const allowed = { calendarEnabled: true, contactsEnabled: true, filesEnabled: true,
    privateCalendarEnabled: true, privateContactsEnabled: true, privateFilesEnabled: true };
  const denied = Object.fromEntries(Object.keys(allowed).map(key => [key, false]));
  access.set('alice@example.test', true);
  access.set('bob@example.test', false);
  expect(await read(0)).toMatchObject(allowed);
  expect(await read(1)).toMatchObject(denied);
  access.set('alice@example.test', false);
  expect(await read(0)).toMatchObject(denied);
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true }); });

it('serves the configured Inbox login and product logout URLs through the real config manager', async () => {
  const { GET } = await import('@/app/api/config/route');
  const response = await GET(new NextRequest('https://mail.example.test/api/config'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    appName: 'Comail',
    atprotoLoginUrl: 'https://mail.example.test/webmail/login',
    hostedInboxLogoutDestination: 'https://example.test/?signed_out=1',
  });
});
