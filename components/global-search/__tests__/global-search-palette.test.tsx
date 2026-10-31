import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactHit, MailHit, SearchOutcome } from '@/lib/global-search/types';
import { emptyOutcome } from '@/lib/global-search/types';
import { parseSearchQuery } from '@/lib/global-search/query-parser';
import { useGlobalSearchStore } from '@/stores/global-search-store';
import { useProTabStore } from '@/stores/pro-tab-store';
import { useSearchHistoryStore } from '@/stores/search-history-store';

const openHit = vi.fn();
vi.mock('@/lib/global-search/open-hit', () => ({ openHit: (...args: unknown[]) => openHit(...args) }));

const searchState: {
  outcome: SearchOutcome;
  parsed: ReturnType<typeof parseSearchQuery>;
  isSearching: boolean;
  isEmpty: boolean;
} = {
  outcome: emptyOutcome(),
  parsed: parseSearchQuery(''),
  isSearching: false,
  isEmpty: true,
};
vi.mock('@/hooks/use-global-search', () => ({
  useGlobalSearch: () => ({ ...searchState, rerun: vi.fn(), loadMoreMail: vi.fn(), mailLimit: 25 }),
}));

vi.mock('@/stores/account-store', () => {
  const state = {
    getActiveAccount: () => undefined,
    accounts: [
      { id: 'login-a', label: 'Work', email: 'a@x', isConnected: true },
      { id: 'login-b', label: 'Home', email: 'b@x', isConnected: true },
    ],
  };
  const hook = (sel?: (s: typeof state) => unknown) => (typeof sel === 'function' ? sel(state) : state);
  hook.getState = () => state;
  return { useAccountStore: hook };
});

import { GlobalSearchPalette } from '../global-search-palette';

function mailHit(id: string, title: string): MailHit {
  return {
    kind: 'mail', localAccountId: 'login-a', jmapAccountId: 'j', id, accountLabel: 'Work',
    title, subtitle: 'Inbox', date: '2026-01-01T00:00:00Z', source: 'remote',
    email: { id } as MailHit['email'], snippet: null,
  };
}

function contactHit(id: string, title: string): ContactHit {
  return {
    kind: 'contacts', localAccountId: 'login-a', jmapAccountId: 'j', id, accountLabel: 'Work',
    title, subtitle: 'Personal', date: null, source: 'remote',
    contact: { id } as ContactHit['contact'], storeId: `login-a::${id}`,
  };
}

describe('GlobalSearchPalette', () => {
  beforeEach(() => {
    openHit.mockReset();
    useGlobalSearchStore.setState({ isOpen: true, query: '', scope: 'all', accountId: null });
    useSearchHistoryStore.setState({ recentSearches: [] });
    searchState.outcome = emptyOutcome();
    searchState.parsed = parseSearchQuery('');
    searchState.isSearching = false;
    searchState.isEmpty = true;
  });

  it('renders nothing while closed', () => {
    useGlobalSearchStore.setState({ isOpen: false });
    render(<GlobalSearchPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows recent searches for an empty query and re-fills the input from one', () => {
    useSearchHistoryStore.setState({ recentSearches: ['zebra report'] });
    render(<GlobalSearchPalette />);
    fireEvent.click(screen.getByText('zebra report'));
    expect(useGlobalSearchStore.getState().query).toBe('zebra report');
  });

  it('groups hits by kind and opens a clicked row', () => {
    useGlobalSearchStore.setState({ query: 'zeb' });
    searchState.parsed = parseSearchQuery('zeb');
    searchState.isEmpty = false;
    const outcome = emptyOutcome();
    outcome.hits.mail = [mailHit('m1', 'Zebra subject')];
    outcome.hits.contacts = [contactHit('c1', 'Zebra Person')];
    outcome.status.mail.status = 'done';
    outcome.status.contacts.status = 'done';
    searchState.outcome = outcome;
    render(<GlobalSearchPalette />);

    expect(screen.getByText('Zebra subject')).toBeInTheDocument();
    expect(screen.getByText('Zebra Person')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Zebra Person'));
    expect(openHit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'contacts', id: 'c1', storeId: 'login-a::c1' }),
      expect.objectContaining({ proShell: true }),
    );
    expect(useGlobalSearchStore.getState().isOpen).toBe(false);
    expect(useSearchHistoryStore.getState().recentSearches).toContain('zeb');
  });

  it('shows a per-account error row', () => {
    useGlobalSearchStore.setState({ query: 'zeb' });
    searchState.parsed = parseSearchQuery('zeb');
    searchState.isEmpty = false;
    const outcome = emptyOutcome();
    outcome.status.mail.status = 'done';
    outcome.status.mail.errors = [{ localAccountId: 'login-b', accountLabel: 'Home', message: 'timeout' }];
    searchState.outcome = outcome;
    render(<GlobalSearchPalette />);
    expect(screen.getByText('account_error')).toBeInTheDocument();
  });

  it('Enter in the input opens a search tab with the query', () => {
    useGlobalSearchStore.setState({ query: 'zebra report', scope: 'mail' });
    searchState.parsed = parseSearchQuery('zebra report');
    searchState.isEmpty = false;
    render(<GlobalSearchPalette />);
    const input = screen.getByPlaceholderText('placeholder') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    const tab = useProTabStore.getState().tabs.find((t) => t.kind === 'search');
    expect(tab?.searchData).toMatchObject({ query: 'zebra report', scope: 'mail', accountId: null });
    expect(useGlobalSearchStore.getState().isOpen).toBe(false);
  });

  it('ArrowDown moves focus from the input into the first result row', () => {
    useGlobalSearchStore.setState({ query: 'zeb' });
    searchState.parsed = parseSearchQuery('zeb');
    searchState.isEmpty = false;
    const outcome = emptyOutcome();
    outcome.hits.mail = [mailHit('m1', 'Zebra subject'), mailHit('m2', 'Second')];
    outcome.status.mail.status = 'done';
    searchState.outcome = outcome;
    render(<GlobalSearchPalette />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).textContent).toContain('Zebra subject');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).textContent).toContain('Second');
  });

  it('Escape closes the palette', () => {
    render(<GlobalSearchPalette />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useGlobalSearchStore.getState().isOpen).toBe(false);
  });

  it('scope chips update the store scope', () => {
    render(<GlobalSearchPalette />);
    fireEvent.click(screen.getByRole('radio', { name: 'scope_files' }));
    expect(useGlobalSearchStore.getState().scope).toBe('files');
  });
});
