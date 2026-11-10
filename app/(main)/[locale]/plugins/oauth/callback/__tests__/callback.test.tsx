import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLUGIN_OAUTH_EVENT, PLUGIN_OAUTH_STORAGE_KEY } from '@/lib/plugin-oauth';
import CallbackPage from '../page';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('code=one-time-code&state=test-state') }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/auth/oauth-status-card', () => ({ OAuthStatusCard: ({ title }: { title: string }) => <div>{title}</div> }));

describe('plugin OAuth callback', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('announces the callback without retaining the authorization code', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const listener = vi.fn();
    window.addEventListener(PLUGIN_OAUTH_EVENT, listener);
    const { unmount } = render(<CallbackPage />);
    await waitFor(() => expect(listener).toHaveBeenCalled());
    const callback = setItem.mock.calls.find(([key]) => key === PLUGIN_OAUTH_STORAGE_KEY);
    expect(JSON.parse(callback![1])).toMatchObject({ code: 'one-time-code', state: 'test-state' });
    expect(localStorage.getItem(PLUGIN_OAUTH_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PLUGIN_OAUTH_STORAGE_KEY)).toBeNull();
    unmount();
    window.removeEventListener(PLUGIN_OAUTH_EVENT, listener);
    setItem.mockRestore();
  });
});
