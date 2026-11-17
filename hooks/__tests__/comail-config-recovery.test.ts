import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfig } from '@/lib/__tests__/fixtures/config';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  fetchPolicy: vi.fn(),
}));
vi.mock('@/lib/browser-navigation', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/stores/policy-store', () => ({
  usePolicyStore: { getState: () => ({ fetchPolicy: mocks.fetchPolicy }) },
}));

const config = createConfig();
const success = () => Response.json(config);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.apiFetch.mockReset();
  vi.stubEnv('NEXT_PUBLIC_BULWARK_LITE', '0');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('server configuration recovery', () => {
  it('hydrates server markup when another consumer has already cached configuration', async () => {
    mocks.apiFetch.mockResolvedValueOnce(success());
    const { fetchConfig, useConfig } = await import('../use-config');
    function ConfigScreen() {
      const { isLoading, appName } = useConfig();
      return createElement('div', null, isLoading ? 'Loading configuration' : appName);
    }
    const container = document.createElement('div');
    container.innerHTML = renderToString(createElement(ConfigScreen));
    expect(container.textContent).toBe('Loading configuration');
    document.body.append(container);
    // A parent can finish fetching before a streamed child hydrates.
    await fetchConfig();
    const onRecoverableError = vi.fn();
    const root = hydrateRoot(container, createElement(ConfigScreen), { onRecoverableError });
    try {
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.textContent).toBe(config.appName);
      expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => root.unmount());
      container.remove();
    }
  });

  it('accepts the previous server configuration without the remember-me display flag', async () => {
    const previous: Partial<typeof config> = { ...config };
    delete previous.loginShowRememberMe;
    mocks.apiFetch.mockResolvedValue(Response.json(previous));
    const { fetchConfig } = await import('../use-config');
    const result = fetchConfig().then(value => ({ value }), error => ({ error: error.message }));
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ value: config });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches account-specific configuration again after switching accounts', async () => {
    const { useAccountStore } = await import('@/stores/account-store');
    useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
    const first = useAccountStore.getState().addAccount({
      label: 'Alice', username: 'alice@example.test', serverUrl: 'https://inbox.example', authMode: 'basic', rememberMe: true,
      displayName: 'Alice', email: 'alice@example.test', lastLoginAt: 1, isConnected: true, hasError: false, isDefault: true,
    });
    const second = useAccountStore.getState().addAccount({
      label: 'Bob', username: 'bob@example.test', serverUrl: 'https://inbox.example', authMode: 'basic', rememberMe: true,
      displayName: 'Bob', email: 'bob@example.test', lastLoginAt: 1, isConnected: true, hasError: false, isDefault: false,
    });
    mocks.apiFetch.mockResolvedValueOnce(Response.json(createConfig({ calendarEnabled: true })))
      .mockResolvedValueOnce(Response.json(createConfig({ calendarEnabled: false })));
    const { fetchConfig, getCachedConfig } = await import('../use-config');
    useAccountStore.getState().setActiveAccount(first);
    expect((await fetchConfig()).calendarEnabled).toBe(true);
    expect(getCachedConfig(0)?.calendarEnabled).toBe(true);
    expect(getCachedConfig(1)).toBeNull();
    useAccountStore.getState().setActiveAccount(second);
    expect((await fetchConfig()).calendarEnabled).toBe(false);
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(1, '/api/config', expect.objectContaining({ headers: { 'X-JMAP-Cookie-Slot': '0' } }));
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, '/api/config', expect.objectContaining({ headers: { 'X-JMAP-Cookie-Slot': '1' } }));
    useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  });

  it('loads configuration again when a different account reuses the same cookie slot', async () => {
    const { useAccountStore } = await import('@/stores/account-store');
    useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
    const add = (username: string) => useAccountStore.getState().addAccount({
      label: username, username, serverUrl: 'https://inbox.example', authMode: 'basic', rememberMe: true,
      displayName: username, email: username, lastLoginAt: 1, isConnected: true, hasError: false, isDefault: false,
    });
    const alice = add('alice@example.test');
    useAccountStore.getState().setActiveAccount(alice);
    mocks.apiFetch.mockResolvedValueOnce(Response.json(createConfig({ calendarEnabled: false })));
    const { useConfig } = await import('../use-config');
    const view = renderHook(() => useConfig());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(view.result.current.isLoading).toBe(false);
    let release!: (response: Response) => void;
    mocks.apiFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    await act(async () => {
      useAccountStore.setState({ accounts: [], activeAccountId: null });
      useAccountStore.getState().setActiveAccount(add('bob@example.test'));
    });
    expect(view.result.current.isLoading).toBe(true);
    await act(async () => { release(Response.json(createConfig({ calendarEnabled: true }))); });
    expect(view.result.current).toMatchObject({ isLoading: false, calendarEnabled: true });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    view.unmount();
    useAccountStore.setState({ accounts: [], activeAccountId: null });
  });

});
