import { afterEach, expect, it, vi } from 'vitest';
import { createConfig } from '@/lib/__tests__/fixtures/config';

vi.mock('@/lib/jmap/client', () => {
  class JMAPClient {
    constructor(public serverUrl: string, public username: string, public password: string) {}
    async connect() {}
    disconnect() {}
    getUsername() { return this.username; }
    getSessionUsername() { return this.username; }
    getAuthHeader() { return `Basic ${btoa(`${this.username}:${this.password}`)}`; }
    getAccountId() { return this.username; }
    async getIdentities() { return [{ id: this.username, email: this.username, name: this.username, mayDelete: false }]; }
    onConnectionChange() {}
    onRateLimit() {}
    getRateLimitRemainingMs() { return 0; }
    supportsContacts() { return false; }
    supportsPrincipals() { return false; }
    supportsVacationResponse() { return false; }
    supportsCalendars() { return false; }
    supportsSieve() { return false; }
  }
  return { JMAPClient, RateLimitError: class extends Error {} };
});
vi.mock('@/lib/stalwart/principal', () => ({ fetchPrincipalDisplayName: async () => null }));

import { useAuthStore } from '@/stores/auth-store';
import { useAccountStore } from '@/stores/account-store';
import { useEmailStore } from '@/stores/email-store';
import { useIdentityStore } from '@/stores/identity-store';

const credentials = [
  { serverUrl: 'https://inbox.example', username: 'alice@example.test', password: 'alice-password' },
  undefined,
  { serverUrl: 'https://inbox.example', username: 'bob@example.test', password: 'bob-password', did: 'did:plc:abcdefghijklmnopqrstuvwx' },
];

afterEach(async () => {
  await useAuthStore.getState().logoutAll();
  vi.unstubAllGlobals();
});

it('adopts another Inbox sign-in, restores both sessions, switches state, and signs out only that account', async () => {
  useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  useAuthStore.setState({ activeAccountId: null, client: null, isAuthenticated: false });
  const alice = useAccountStore.getState().addAccount({
    ...credentials[0]!, label: 'Alice', authMode: 'basic', rememberMe: true, displayName: 'Alice',
    email: 'alice@example.test', isDefault: true, isConnected: false, hasError: false, lastLoginAt: 1,
  });
  useAuthStore.setState({ activeAccountId: alice });
  const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const match = url.match(/^\/api\/auth\/session\?slot=(\d+)$/);
    if (match && init?.method === 'PUT') return Response.json(credentials[Number(match[1])]);
    if (url === '/api/config') return Response.json(createConfig({ allowCustomJmapEndpoint: true }));
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetcher);
  window.history.replaceState(null, '', '/en/mail?sso_slot=2');
  await useAuthStore.getState().checkAuth();
  const bob = useAccountStore.getState().accounts.find(account => account.username === 'bob@example.test')!;
  expect(bob.cookieSlot).toBe(2);
  expect(bob.did).toBe(credentials[2]?.did);
  expect(useAuthStore.getState().activeAccountId).toBe(bob.id);
  expect(window.location.search).toBe('');
  await expect.poll(() => useAccountStore.getState().getAccountById(alice)?.isConnected).toBe(true);
  await expect.poll(() => useAuthStore.getState().primaryIdentity?.email).toBe('bob@example.test');

  useEmailStore.setState({ emails: [{ id: 'bob-message', subject: 'Bob mailbox' }] as never });
  await useAuthStore.getState().switchAccount(alice);
  await expect.poll(() => useIdentityStore.getState().identities[0]?.email).toBe('alice@example.test');
  useEmailStore.setState({ emails: [{ id: 'alice-message', subject: 'Alice mailbox' }] as never });
  await useAuthStore.getState().switchAccount(bob.id);
  expect(useEmailStore.getState().emails[0]?.subject).toBe('Bob mailbox');
  expect(useAuthStore.getState().primaryIdentity?.email).toBe('bob@example.test');

  await useAuthStore.getState().logout();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(useAuthStore.getState().activeAccountId).toBe(alice);
  expect(useEmailStore.getState().emails[0]?.subject).toBe('Alice mailbox');
  expect(useAuthStore.getState().primaryIdentity?.email).toBe('alice@example.test');
  expect(useAccountStore.getState().accounts.map(account => account.id)).toEqual([alice]);
  const deletions = fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url);
  expect(deletions).toContain('/api/auth/session?slot=2');
  expect(deletions).not.toContain('/api/auth/session?slot=0');
});

it('keeps the new account active when startup checks overlap during the Inbox handoff', async () => {
  useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  useAuthStore.setState({ activeAccountId: null, client: null, isAuthenticated: false });
  const alice = useAccountStore.getState().addAccount({
    ...credentials[0]!, label: 'Alice', authMode: 'basic', rememberMe: true, displayName: 'Alice',
    email: 'alice@example.test', isDefault: true, isConnected: false, hasError: false, lastLoginAt: 1,
  });
  useAuthStore.setState({ activeAccountId: alice });
  let releaseHandoff!: () => void;
  let releaseAlice!: () => void;
  const handoff = new Promise<void>(resolve => { releaseHandoff = resolve; });
  const aliceRestore = new Promise<void>(resolve => { releaseAlice = resolve; });
  let handoffRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PUT' && url === '/api/auth/session?slot=2') {
      if (++handoffRequests === 1) await handoff;
      return Response.json(credentials[2]);
    }
    if (init?.method === 'PUT' && url === '/api/auth/session?slot=0') {
      await aliceRestore;
      return Response.json(credentials[0]);
    }
    if (url === '/api/config') return Response.json(createConfig({ allowCustomJmapEndpoint: true }));
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/en/mail?sso_slot=2');
  const first = useAuthStore.getState().checkAuth();
  const second = useAuthStore.getState().checkAuth();
  releaseHandoff();
  await first;
  releaseAlice();
  await second;
  const bob = useAccountStore.getState().accounts.find(account => account.username === 'bob@example.test')!;
  expect(useAuthStore.getState().activeAccountId).toBe(bob.id);
  expect(useAccountStore.getState().activeAccountId).toBe(bob.id);
  expect(window.location.search).toBe('');
});
