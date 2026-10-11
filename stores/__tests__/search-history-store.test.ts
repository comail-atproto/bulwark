import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchHistoryStore, MAX_RECENT_SEARCHES } from '../search-history-store';

describe('search-history-store', () => {
  beforeEach(() => {
    useSearchHistoryStore.setState({ recentSearches: [] });
  });

  it('adds trimmed queries most-recent first', () => {
    const { addRecentSearch } = useSearchHistoryStore.getState();
    addRecentSearch('  invoice ');
    addRecentSearch('mustafa');
    expect(useSearchHistoryStore.getState().recentSearches).toEqual(['mustafa', 'invoice']);
  });

  it('ignores empty or whitespace-only queries', () => {
    const { addRecentSearch } = useSearchHistoryStore.getState();
    addRecentSearch('');
    addRecentSearch('   ');
    expect(useSearchHistoryStore.getState().recentSearches).toEqual([]);
  });

  it('moves a repeated query to the front instead of duplicating it (case-insensitive)', () => {
    const { addRecentSearch } = useSearchHistoryStore.getState();
    addRecentSearch('invoice');
    addRecentSearch('mustafa');
    addRecentSearch('Invoice');
    expect(useSearchHistoryStore.getState().recentSearches).toEqual(['Invoice', 'mustafa']);
  });

  it('caps the history length', () => {
    const { addRecentSearch } = useSearchHistoryStore.getState();
    for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i++) addRecentSearch(`query ${i}`);
    const { recentSearches } = useSearchHistoryStore.getState();
    expect(recentSearches).toHaveLength(MAX_RECENT_SEARCHES);
    expect(recentSearches[0]).toBe(`query ${MAX_RECENT_SEARCHES + 4}`);
  });

  it('removes a single entry and clears everything', () => {
    const { addRecentSearch, removeRecentSearch, clearRecentSearches } = useSearchHistoryStore.getState();
    addRecentSearch('a');
    addRecentSearch('b');
    removeRecentSearch('a');
    expect(useSearchHistoryStore.getState().recentSearches).toEqual(['b']);
    clearRecentSearches();
    expect(useSearchHistoryStore.getState().recentSearches).toEqual([]);
  });
});
