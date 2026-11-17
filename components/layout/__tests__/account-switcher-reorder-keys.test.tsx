import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

// MO-06: the account order in the switcher was drag-only. Alt+Shift+↑/↓ on
// an account moves it.

const { AccountSwitcher } = await import('../account-switcher');
const { useAccountStore } = await import('@/stores/account-store');
const { useAuthStore } = await import('@/stores/auth-store');
const { useSettingsStore } = await import('@/stores/settings-store');

function account(id: string) {
  return {
    id, label: `${id}@example.com`, email: `${id}@example.com`, username: `${id}@example.com`,
    displayName: id.toUpperCase(), serverUrl: 'https://mail.example.com', avatarColor: '#336699',
    cookieSlot: 0, isConnected: true, isDefault: id === 'a',
  };
}

beforeEach(() => {
  useAccountStore.setState({ accounts: [account('a'), account('b'), account('c'), account('d')] } as never);
  useAuthStore.setState({ activeAccountId: 'a' } as never);
  useSettingsStore.setState({ interfaceLayout: 'default' } as never);
});

const ids = () => useAccountStore.getState().accounts.map((a) => a.id);
const option = (id: string) => screen.getAllByTestId('account-option').find((el) => el.getAttribute('data-account-id') === id)!;

describe('account switcher reorder keys', () => {
  it('moves an account down and up', () => {
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    fireEvent.keyDown(option('b'), { key: 'ArrowDown', altKey: true, shiftKey: true });
    expect(ids()).toEqual(['a', 'c', 'b', 'd']);
    fireEvent.keyDown(option('d'), { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(ids()).toEqual(['a', 'c', 'd', 'b']);
  });

  it('leaves plain arrows to the menu', () => {
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    fireEvent.keyDown(option('b'), { key: 'ArrowDown' });
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never moves the default account', () => {
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    fireEvent.keyDown(option('b'), { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
  });
});
