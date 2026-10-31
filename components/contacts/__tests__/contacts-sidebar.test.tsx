import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactsSidebar } from '../contacts-sidebar';
import type { AddressBook, ContactCard } from '@/lib/jmap/types';

// next-intl + next/navigation are mocked globally in vitest.setup (t returns the key).
vi.mock('@/stores/account-store', () => {
  const state = { accounts: [], activeAccountId: null };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  return { useAccountStore: hook };
});

const group = {
  id: 'g1',
  kind: 'group',
  name: { full: 'Team' },
  members: { '1': true },
} as unknown as ContactCard;

function renderSidebar(onComposeGroup = vi.fn()) {
  render(
    <ContactsSidebar
      groups={[group]}
      individuals={[]}
      addressBooks={[]}
      activeCategory="all"
      onSelectCategory={vi.fn()}
      onCreateGroup={vi.fn()}
      onCreateContact={vi.fn()}
      onEditGroup={vi.fn()}
      onDeleteGroup={vi.fn()}
      onComposeGroup={onComposeGroup}
    />,
  );
  return onComposeGroup;
}

describe('ContactsSidebar — compose to group', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a "Send email to group" submenu in the group context menu', () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText('Team'));
    expect(screen.getByText('groups.send_email')).toBeInTheDocument();
    // and the existing Edit/Delete entries still render
    expect(screen.getByText('groups.edit')).toBeInTheDocument();
    expect(screen.getByText('form.delete')).toBeInTheDocument();
  });

  it('calls onComposeGroup(groupId, field) when a To/Cc/Bcc item is clicked', () => {
    const onComposeGroup = renderSidebar();
    fireEvent.contextMenu(screen.getByText('Team'));

    // Open the submenu (hover) then click "Cc".
    const trigger = screen.getByText('groups.send_email').closest('.relative')!;
    fireEvent.mouseOver(trigger);
    fireEvent.mouseEnter(trigger);

    fireEvent.click(screen.getByText('groups.send_email_cc'));
    expect(onComposeGroup).toHaveBeenCalledWith('g1', 'cc');
  });
});

const books: AddressBook[] = [
  { id: 'ab-1', name: 'Personal', isDefault: true },
  { id: 'ab-2', name: 'Work' },
  { id: 'ab-3', name: 'Team', isShared: true, accountId: 'account-2', accountName: 'Team account' },
];

function renderBooksSidebar(onSetDefaultAddressBook = vi.fn()) {
  render(
    <ContactsSidebar
      groups={[]}
      individuals={[]}
      addressBooks={books}
      activeCategory="all"
      onSelectCategory={vi.fn()}
      onCreateGroup={vi.fn()}
      onCreateContact={vi.fn()}
      onSetDefaultAddressBook={onSetDefaultAddressBook}
    />,
  );
  return onSetDefaultAddressBook;
}

describe('ContactsSidebar - set default address book', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers "Set as default" for an owned, non-default book', () => {
    const onSetDefaultAddressBook = renderBooksSidebar();
    fireEvent.contextMenu(screen.getByText('Work'));

    fireEvent.click(screen.getByText('address_books.set_default'));
    expect(onSetDefaultAddressBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'ab-2' }));
  });

  it('hides it for the book that is already the default', () => {
    renderBooksSidebar();
    fireEvent.contextMenu(screen.getByText('Personal'));

    expect(screen.queryByText('address_books.set_default')).not.toBeInTheDocument();
  });

  it('hides it for a book shared from another account', () => {
    renderBooksSidebar();
    fireEvent.contextMenu(screen.getByText('Team'));

    expect(screen.queryByText('address_books.set_default')).not.toBeInTheDocument();
  });
});
