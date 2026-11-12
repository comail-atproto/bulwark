import { beforeEach, describe, expect, it, vi } from 'vitest';

// WCAG 2.2.5: when the server refuses to renew the session, the open
// composers save their drafts (with the access token that still works)
// before the sign-out throws their state away, and the login page learns
// when a draft couldn't be saved.

const calls: string[] = [];
const flushResult = { total: 1, settled: 1, failed: 0, timedOut: false };
vi.mock('@/lib/compose-flush-registry', () => ({
  flushComposers: vi.fn(async () => {
    calls.push('flush');
    return flushResult;
  }),
}));

let useAuthStore: typeof import('../auth-store').useAuthStore;
let useAccountStore: typeof import('../account-store').useAccountStore;

function response(status: number, body: unknown = {}) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url: '',
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return res; },
  };
  return res;
}

describe('an expired session saves the open drafts first', () => {
  beforeEach(async () => {
    calls.length = 0;
    flushResult.failed = 0;
    vi.resetModules();
    ({ useAuthStore } = await import('../auth-store'));
    ({ useAccountStore } = await import('../account-store'));
    const browserNavigation = await import('@/lib/browser-navigation');
    vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});
    sessionStorage.clear();
    // Every token request is refused: the session is over.
    vi.stubGlobal('fetch', vi.fn(async () => response(401, { error: 'invalid_grant' })));
    useAccountStore.setState({
      accounts: [{
        id: 'a', label: 'a', serverUrl: 'https://mail.example.test', username: 'a@example.test',
        authMode: 'oauth', rememberMe: true, displayName: 'a', email: 'a@example.test',
        lastLoginAt: Date.now(), isConnected: true, hasError: false, isDefault: true, cookieSlot: 0, avatarColor: '#000',
      }],
      activeAccountId: 'a',
    } as never);
    const realLogout = useAuthStore.getState().logout;
    useAuthStore.setState({
      isAuthenticated: true,
      activeAccountId: 'a',
      authMode: 'oauth',
      logout: (async (options?: unknown) => {
        calls.push('logout');
        return realLogout(options as never);
      }) as never,
    } as never);
  });

  it('flushes the composers before it signs out', async () => {
    await useAuthStore.getState().refreshAccessToken({ accountId: 'a' });
    expect(calls).toEqual(['flush', 'logout']);
    expect(sessionStorage.getItem('session_expired')).toBe('true');
    expect(sessionStorage.getItem('session_expired_drafts_unsaved')).toBeNull();
  }, 30_000);

  it('tells the login page when a draft could not be saved', async () => {
    flushResult.failed = 1;
    await useAuthStore.getState().refreshAccessToken({ accountId: 'a' });
    expect(sessionStorage.getItem('session_expired_drafts_unsaved')).toBe('true');
  }, 30_000);
});
