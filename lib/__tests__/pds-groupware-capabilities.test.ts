import { afterEach, expect, it, vi } from 'vitest';
import { SpaceCalendarAdapter } from '@/lib/jmap/space-calendar-adapter';
import { AtmoCalendarAdapter } from '@/lib/jmap/atmo-calendar-adapter';
import { JMAPClient } from '../jmap/client';
import { jmapSession } from './fixtures/jmap-session';
import { useAccountStore } from '@/stores/account-store';
import { syncVacationBlock } from '@/lib/vacation-calendar';

const serverUrl = 'https://mail.example.com';
const username = 'member@example.test';

afterEach(() => {
  vi.restoreAllMocks();
  useAccountStore.setState({ accounts: [], activeAccountId: null });
});

it('keeps configured PDS gates authoritative when Stalwart advertises calendars and contacts', async () => {
  const id = useAccountStore.getState().addAccount({ serverUrl, username, label: 'Member', email: username, displayName: 'Member', authMode: 'basic', rememberMe: true, lastLoginAt: 1, isConnected: true, hasError: false, isDefault: true });
  const slot = useAccountStore.getState().getAccountById(id)!.cookieSlot;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(jmapSession({ accountCapabilities: {
    'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:calendars': {}, 'urn:ietf:params:jmap:contacts': {},
  } })));
  const client = new JMAPClient(serverUrl, username, 'synthetic');
  await client.connect();
  expect(client.supportsCalendars()).toBe(true);
  expect(client.supportsContacts()).toBe(true);
  client.configurePrivateGroupware(slot, { calendar: false, contacts: false });
  expect(client.supportsCalendars()).toBe(false);
  expect(client.supportsContacts()).toBe(false);
  fetcher.mockClear();
  expect(await syncVacationBlock(client, undefined, { isEnabled: false, fromDate: null, toDate: null, subject: '' }, 'load')).toBe('none');
  expect(fetcher).not.toHaveBeenCalled();
  client.configurePrivateGroupware(slot, { calendar: true, contacts: true });
  expect(client.supportsCalendars()).toBe(true);
  expect(client.supportsContacts()).toBe(true);
  useAccountStore.getState().updateAccount(id, { cookieSlot: slot + 1 });
  expect(client.supportsCalendars()).toBe(false);
  expect(client.supportsContacts()).toBe(false);
});

it('discovers private calendars and contacts without restoring Stalwart permissions', async () => {
  const id = useAccountStore.getState().addAccount({ serverUrl, username, label: 'Member', email: username, displayName: 'Member', authMode: 'basic', rememberMe: true, lastLoginAt: 1, isConnected: true, hasError: false, isDefault: true });
  const slot = useAccountStore.getState().getAccountById(id)!.cookieSlot;
  const session = jmapSession({ accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...session, accounts: { ...session.accounts, shared: { name: 'Shared', isPersonal: false, accountCapabilities: { 'urn:ietf:params:jmap:contacts': {}, 'urn:ietf:params:jmap:calendars': {} } } } }));
  const client = new JMAPClient(serverUrl, username, 'synthetic');
  await client.connect();
  expect(client.supportsCalendars()).toBe(false);
  expect(client.supportsContacts()).toBe(false);
  expect(client.supportsCalendars('shared')).toBe(true);
  client.configurePrivateGroupware(slot, { calendar: true, contacts: true });
  expect(client.supportsCalendars()).toBe(true);
  expect(client.supportsContacts()).toBe(true);
  const calendars = vi.spyOn(SpaceCalendarAdapter.prototype, 'getCalendars').mockResolvedValue([]);
  vi.spyOn(AtmoCalendarAdapter.prototype, 'getCalendars').mockResolvedValue([]);
  const network = vi.mocked(globalThis.fetch);
  network.mockClear();
  expect(await client.getAllCalendars()).toEqual([]);
  expect(await client.getCalendars()).toEqual([]);
  expect(await client.getCalendarEventNotifications()).toEqual([]);
  expect(await client.getParticipantIdentities()).toEqual([]);
  expect(calendars).toHaveBeenCalledTimes(2);
  expect(network).not.toHaveBeenCalled();
  expect(client.supportsCalendars('other-account')).toBe(false);
  expect(client.supportsContacts('other-account')).toBe(false);
  expect(client.supportsCalendars('shared')).toBe(false);
  expect(client.supportsContacts('shared')).toBe(false);
  expect(client.accountSupports('acct-1', 'urn:ietf:params:jmap:calendars')).toBe(false);
  expect(client.accountSupports('acct-1', 'urn:ietf:params:jmap:contacts')).toBe(false);
  client.configurePrivateGroupware(slot, { calendar: false, contacts: false });
  expect(client.supportsCalendars()).toBe(false);
  expect(client.supportsContacts()).toBe(false);
  client.configurePrivateGroupware(slot, { calendar: true, contacts: true });
  useAccountStore.getState().updateAccount(id, { cookieSlot: slot + 1 });
  expect(client.supportsCalendars()).toBe(false);
  expect(client.supportsContacts()).toBe(false);
});

it('advertises private Files before any inventory probe and binds it to the configured account slot', async () => {
  const id = useAccountStore.getState().addAccount({ serverUrl, username, label: 'Member', email: username, displayName: 'Member', authMode: 'basic', rememberMe: true, lastLoginAt: 1, isConnected: true, hasError: false, isDefault: true });
  const slot = useAccountStore.getState().getAccountById(id)!.cookieSlot;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(jmapSession({ accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } })));
  const client = new JMAPClient(serverUrl, username, 'synthetic');
  await client.connect();
  fetcher.mockClear();
  expect(client.supportsFiles()).toBe(false);
  client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
  expect(client.supportsFiles()).toBe(true);
  expect(client.supportsFiles('other-account')).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: false });
  expect(client.supportsFiles()).toBe(false);
  client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
  useAccountStore.getState().updateAccount(id, { cookieSlot: slot + 1 });
  expect(client.supportsFiles()).toBe(false);
});
