import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolAccountPicker } from '../protocol-account-picker';
import type { AccountEntry } from '@/stores/account-store';

// The "which account?" question for a mailto: or webcal: link is a modal:
// the focus starts on the account in use, Escape cancels, and the focus
// comes back to where it was.

const account = (id: string, email: string) =>
  ({ id, email, label: email, username: email, serverUrl: 'https://mail.example.org', displayName: '' }) as unknown as AccountEntry;

let opener: HTMLButtonElement;
beforeEach(() => {
  opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
});
afterEach(() => opener.remove());

describe('ProtocolAccountPicker', () => {
  it('focuses the active account, cancels on Escape and gives the focus back', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <ProtocolAccountPicker
        kind="mailto"
        accounts={[account('a', 'ann@example.org'), account('b', 'bob@example.org')]}
        activeAccountId="b"
        onSelect={() => {}}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'select_account_title' });
    const active = screen.getByText('bob@example.org', { selector: 'span' }).closest('button')!;
    expect(active).toHaveFocus();
    expect(active).toHaveAttribute('aria-current', 'true');

    fireEvent.keyDown(active, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
    unmount();
    expect(opener).toHaveFocus();
  });

  it('ignores Escape while it switches accounts', () => {
    const onCancel = vi.fn();
    render(
      <ProtocolAccountPicker kind="webcal" accounts={[account('a', 'ann@example.org')]} activeAccountId="a" isSwitching onSelect={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
