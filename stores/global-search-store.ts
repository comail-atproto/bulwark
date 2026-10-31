import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SearchScope } from '@/lib/global-search/query-parser';

/**
 * State of the global search palette (#641). The palette is a single modal
 * per shell; the search tab keeps its own results per tab through
 * `useGlobalSearch`, so only what the palette needs lives here. The last scope
 * is remembered across reloads; the account chip and the query are not.
 */
interface GlobalSearchState {
  isOpen: boolean;
  query: string;
  scope: SearchScope;
  /** `AccountEntry.id` to restrict to, or null for every login. */
  accountId: string | null;
  openPalette: (initialQuery?: string) => void;
  closePalette: () => void;
  togglePalette: () => void;
  setQuery: (query: string) => void;
  setScope: (scope: SearchScope) => void;
  setAccountId: (accountId: string | null) => void;
}

const SCOPES: readonly SearchScope[] = ['all', 'mail', 'contacts', 'calendar', 'files'];

export const useGlobalSearchStore = create<GlobalSearchState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      query: '',
      scope: 'all',
      accountId: null,

      openPalette: (initialQuery) => set({
        isOpen: true,
        ...(initialQuery !== undefined ? { query: initialQuery } : {}),
      }),
      closePalette: () => set({ isOpen: false }),
      togglePalette: () => set({ isOpen: !get().isOpen }),
      setQuery: (query) => set({ query }),
      setScope: (scope) => set({ scope: SCOPES.includes(scope) ? scope : 'all' }),
      setAccountId: (accountId) => set({ accountId }),
    }),
    {
      name: 'global-search',
      version: 1,
      partialize: (state) => ({ scope: state.scope }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<GlobalSearchState> | undefined;
        const scope = saved?.scope && SCOPES.includes(saved.scope) ? saved.scope : 'all';
        return { ...current, scope };
      },
    },
  ),
);
