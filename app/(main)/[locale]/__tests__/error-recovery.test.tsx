import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LocaleError from '../error';

const auth = vi.hoisted(() => ({ logout: vi.fn(), removeAccount: vi.fn(), error: null }));
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ appName: 'Comail', hostedInboxLogoutDestination: 'https://inbox.example.test' }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/stores/account-store', () => ({
  useAccountStore: (selector: (state: { accounts: [] }) => unknown) => selector({ accounts: [] }),
}));

afterEach(() => vi.restoreAllMocks());

it('keeps accessible upstream recovery and Comail sign-out on route errors', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reset = vi.fn();
  render(<LocaleError error={new Error('route failed')} reset={reset} />);

  expect(screen.getByRole('alert')).toHaveTextContent('page_error_title');
  expect(screen.getByRole('link', { name: 'go_home' })).toHaveAttribute('href', '/');
  fireEvent.click(screen.getByRole('button', { name: 'try_again' }));
  expect(reset).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out of Inbox' }));
  expect(auth.logout).toHaveBeenCalledOnce();
});
