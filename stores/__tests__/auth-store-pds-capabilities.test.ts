import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '../auth-store';
import { useAccountStore } from '../account-store';
import { useCalendarStore } from '../calendar-store';
import { useContactStore } from '../contact-store';
import { resetConfigCache } from '@/hooks/use-config';
import { JMAPClient } from '@/lib/jmap/client';
import { createConfig } from '@/lib/__tests__/fixtures/config';
import { jmapSession } from '@/lib/__tests__/fixtures/jmap-session';

beforeEach(() => {
  vi.clearAllMocks();
  useAccountStore.setState({ accounts: [], activeAccountId: null });
  useAuthStore.setState({ client: null, activeAccountId: null, isAuthenticated: false });
  resetConfigCache();
  vi.spyOn(useCalendarStore.getState(), 'fetchCalendars').mockResolvedValue(undefined);
  vi.spyOn(useContactStore.getState(), 'fetchContacts').mockResolvedValue(undefined);
  vi.spyOn(useContactStore.getState(), 'fetchAddressBooks').mockResolvedValue(undefined);
  useCalendarStore.getState().setSupported(false);
  useContactStore.getState().setSupportsSync(false);
});
afterEach(() => {
  useAuthStore.setState({ client: null, activeAccountId: null, isAuthenticated: false });
  useAccountStore.setState({ accounts: [], activeAccountId: null });
  resetConfigCache();
  vi.restoreAllMocks();
});

async function member(username: string) {
  const serverUrl = 'https://mail.example.com';
  const id = useAccountStore.getState().addAccount({ serverUrl, username, label: username, displayName: username, email: username, authMode: 'basic', rememberMe: true, lastLoginAt: 1, isConnected: true, hasError: false, isDefault: false });
  const client = new JMAPClient(serverUrl, username, 'synthetic');
  await client.connect();
  return { id, client };
}
function activate({ id, client }: Awaited<ReturnType<typeof member>>) {
  useAccountStore.getState().setActiveAccount(id);
  useAuthStore.setState({ client, activeAccountId: id, isAuthenticated: true });
}

it('enables private stores when delayed account configuration arrives, without legacy RPCs', async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/.well-known/jmap')) return Response.json(jmapSession({ accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } }));
    if (String(input) === '/api/config') return pending;
    return Response.json({});
  });
  const alice = await member('alice@example.test');
  activate(alice);
  expect(useCalendarStore.getState().supportsCalendar).toBe(false);
  expect(useContactStore.getState().supportsSync).toBe(false);
  expect(alice.client.supportsFiles()).toBe(false);
  resolve(Response.json(createConfig({ calendarEnabled: true, contactsEnabled: true, privateCalendarEnabled: true, privateContactsEnabled: true, filesEnabled: true, privateFilesEnabled: true })));
  await expect.poll(() => useCalendarStore.getState().supportsCalendar).toBe(true);
  expect(useContactStore.getState().supportsSync).toBe(true);
  expect(alice.client.supportsFiles()).toBe(true);
  expect(useCalendarStore.getState().fetchCalendars).toHaveBeenCalledWith(alice.client);
  expect(useContactStore.getState().fetchContacts).toHaveBeenCalledWith(alice.client);
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/jmap/api'))).toBe(false);
});

it('ignores an old account configuration after switching to a mail-only account', async () => {
  let resolveAlice!: (response: Response) => void;
  const aliceConfig = new Promise<Response>(done => { resolveAlice = done; });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('/.well-known/jmap')) return Response.json(jmapSession({ accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } }));
    if (String(input) === '/api/config') return new Headers(init?.headers).get('X-JMAP-Cookie-Slot') === '0' ? aliceConfig : Response.json(createConfig());
    return Response.json({});
  });
  const alice = await member('alice@example.test');
  const bob = await member('bob@example.test');
  activate(alice);
  activate(bob);
  resolveAlice(Response.json(createConfig({ calendarEnabled: true, contactsEnabled: true, privateCalendarEnabled: true, privateContactsEnabled: true, filesEnabled: true, privateFilesEnabled: true })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(bob.client.supportsCalendars()).toBe(false);
  expect(bob.client.supportsContacts()).toBe(false);
  expect(bob.client.supportsFiles()).toBe(false);
  expect(useCalendarStore.getState().supportsCalendar).toBe(false);
  expect(useContactStore.getState().supportsSync).toBe(false);
  expect(useCalendarStore.getState().fetchCalendars).not.toHaveBeenCalled();
});

it('discovers an inactive account restored in the background without selecting it', async () => {
  const serverUrl = 'https://mail.example.com';
  const add = (username: string) => useAccountStore.getState().addAccount({ serverUrl, username, label: username, displayName: username, email: username, authMode: 'basic', rememberMe: true, lastLoginAt: 1, isConnected: false, hasError: false, isDefault: false });
  const alice = add('alice@example.test');
  const bob = add('bob@example.test');
  useAccountStore.getState().setActiveAccount(alice);
  useAuthStore.setState({ activeAccountId: alice });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/config') {
      const enabled = new Headers(init?.headers).get('X-JMAP-Cookie-Slot') === '1';
      return Response.json(createConfig({ allowCustomJmapEndpoint: true, calendarEnabled: enabled, contactsEnabled: enabled, privateCalendarEnabled: enabled, privateContactsEnabled: enabled, filesEnabled: enabled, privateFilesEnabled: enabled }));
    }
    if (url.includes('/.well-known/jmap')) return Response.json(jmapSession({ accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } }));
    if (url === '/api/auth/session?slot=0' || url === '/api/auth/session?slot=1') return Response.json({ serverUrl, username: url.endsWith('0') ? 'alice@example.test' : 'bob@example.test', password: 'synthetic' });
    if (url.endsWith('/jmap/api')) return Response.json({ methodResponses: [['Identity/get', { list: [] }, '0']] });
    return Response.json({});
  });
  await useAuthStore.getState().checkAuth();
  await expect.poll(() => useAuthStore.getState().getClientForAccount(bob)?.supportsCalendars()).toBe(true);
  expect(useAuthStore.getState().getClientForAccount(bob)?.supportsContacts()).toBe(true);
  expect(useAuthStore.getState().getClientForAccount(bob)?.supportsFiles()).toBe(true);
  expect(useAuthStore.getState().activeAccountId).toBe(alice);
  expect(useAuthStore.getState().client?.supportsCalendars()).toBe(false);
  expect(useCalendarStore.getState().supportsCalendar).toBe(false);
});
