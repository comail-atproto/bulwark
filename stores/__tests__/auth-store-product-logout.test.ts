import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as navigation from '@/lib/browser-navigation';
import * as iframeBridge from '@/lib/iframe-bridge';
import { fetchConfig, getCachedConfig, resetConfigCache } from '@/hooks/use-config';
import { createConfig } from '@/lib/__tests__/fixtures/config';
import { useAuthStore } from '../auth-store';
import { useAccountStore, type AccountEntry } from '../account-store';

function account(slot: number): AccountEntry {
  return {
    id: `account-${slot}`, label: `Account ${slot}`, serverUrl: 'https://mail.example.test',
    username: `member${slot}@example.test`, authMode: 'oauth', cookieSlot: slot, rememberMe: true,
    providerSession: true, displayName: `Account ${slot}`, email: `member${slot}@example.test`,
    avatarColor: '#000000', did: `did:plc:stored${slot}`, lastLoginAt: 1, isConnected: false,
    hasError: true, isDefault: slot === 0,
  };
}

const fetchMock = vi.fn<typeof fetch>();
let replace: ReturnType<typeof vi.spyOn>;
let signoutStatuses = [204];
let omitDidAfterFirst = false;
const sessionCalls = new Map<number, number>();

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(iframeBridge, 'isEmbedded').mockReturnValue(false);
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/en/mail');
  useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  useAuthStore.setState({
    isAuthenticated: true, isLoading: false, client: null, activeAccountId: null,
    authMode: 'oauth', isDemoMode: false, error: null,
  });
  fetchMock.mockReset();
  const config = createConfig({ appName: 'Comail', atprotoLoginUrl: `${window.location.origin}/webmail/login`, hostedInboxLogoutDestination: 'https://comail.at/?signed_out=1' });
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(config), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  resetConfigCache();
  await fetchConfig();
  expect(getCachedConfig()?.hostedInboxLogoutDestination).toBe('https://comail.at/?signed_out=1');
  signoutStatuses = [204];
  omitDidAfterFirst = false;
  sessionCalls.clear();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const slot = Number(url.match(/slot=(\d+)/)?.[1]);
    if (url.includes('/api/auth/session?') && url.includes('local_only=true')) {
      const calls = (sessionCalls.get(slot) ?? 0) + 1;
      sessionCalls.set(slot, calls);
      return new Response(JSON.stringify(omitDidAfterFirst && calls > 1 ? {} : { did: `did:plc:sealed${slot}` }), { status: 200 });
    }
    if (url.includes('/api/auth/token?') && url.includes('local_only=true')) return new Response('{}', { status: 200 });
    if (url === `${window.location.origin}/api/v1/account/signout`) {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('X-Comail-Account-Did')).toMatch(/^did:plc:sealed/);
      const status = signoutStatuses.shift() ?? 204;
      return new Response(null, { status, headers: status === 204 ? { 'Cache-Control': 'no-store', 'X-Comail-Auth-Cleanup': 'inbox-session-v1' } : {} });
    }
    return new Response('{}', { status: 200 });
  });
  replace = vi.spyOn(navigation, 'replaceWindowLocation').mockImplementation(() => {});
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllGlobals();
});

it('locally removes a selected Comail account, preserves another, and removes that saved account without provider revocation', async () => {
  const selected = account(0);
  const other = account(1);
  useAccountStore.setState({ accounts: [selected, other], activeAccountId: selected.id, defaultAccountId: selected.id });
  useAuthStore.setState({ activeAccountId: selected.id });

  await useAuthStore.getState().logout();
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining(['/api/auth/session?slot=0&local_only=true', '/api/auth/token?slot=0&local_only=true', `${window.location.origin}/api/v1/account/signout`]));
  expect(useAccountStore.getState().getAccountById(selected.id)).toBeUndefined();
  expect(useAccountStore.getState().getAccountById(other.id)).toEqual(expect.objectContaining({ id: other.id, cookieSlot: 1, username: other.username }));
  expect(replace).toHaveBeenCalledWith('https://comail.at/?signed_out=1');

  useAuthStore.getState().removeAccount(other.id);
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('slot=1&local_only=true'))).toBe(true));
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('end_session'))).toBe(false);
});

it('keeps the sealed DID for a failed cleanup retry without navigating to marketing', async () => {
  const selected = account(0);
  useAccountStore.setState({ accounts: [selected], activeAccountId: selected.id, defaultAccountId: selected.id });
  useAuthStore.setState({ activeAccountId: selected.id });
  signoutStatuses = [503, 204]; omitDidAfterFirst = true;

  await useAuthStore.getState().logout();
  expect(replace).not.toHaveBeenCalled();
  expect(useAuthStore.getState().error).toBe('signout_cleanup_failed');
  await useAuthStore.getState().logout();

  expect(replace).toHaveBeenCalledWith('https://comail.at/?signed_out=1');
});

it('targets the new active account after a failed cleanup and fresh sign-in', async () => {
  const first = account(0);
  useAccountStore.setState({ accounts: [first], activeAccountId: first.id });
  useAuthStore.setState({ activeAccountId: first.id });
  signoutStatuses = [503, 204];
  await useAuthStore.getState().logout();
  const next = account(1);
  useAccountStore.setState({ accounts: [next], activeAccountId: next.id });
  useAuthStore.setState({ activeAccountId: next.id });
  await useAuthStore.getState().logout();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('slot=1&local_only=true'))).toBe(true);
});

it('confirms an already empty browser session through Inbox before leaving', async () => {
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input).endsWith('/api/v1/account/signout')) {
      expect(new Headers(init?.headers).has('X-Comail-Account-Did')).toBe(false);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'X-Comail-Auth-Cleanup': 'inbox-session-v1' } });
    }
    return new Response('{}', { status: 200 });
  });
  await useAuthStore.getState().logout();
  expect(replace).toHaveBeenCalledWith('https://comail.at/?signed_out=1');
});
