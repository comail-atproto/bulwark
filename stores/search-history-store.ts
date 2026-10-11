"use client";

// Recent mail searches, surfaced as suggestions under the search bar (#845).
// Only the raw text queries are kept (never filter panel state), most recent
// first, deduplicated, and capped so the dropdown stays scannable.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_RECENT_SEARCHES = 10;

interface SearchHistoryState {
  recentSearches: string[];
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set) => ({
      recentSearches: [],

      addRecentSearch: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => ({
          recentSearches: [
            trimmed,
            ...state.recentSearches.filter((q) => q.toLowerCase() !== trimmed.toLowerCase()),
          ].slice(0, MAX_RECENT_SEARCHES),
        }));
      },

      removeRecentSearch: (query) => {
        set((state) => ({
          recentSearches: state.recentSearches.filter((q) => q !== query),
        }));
      },

      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: "search-history-storage",
      partialize: (state) => ({ recentSearches: state.recentSearches }),
    },
  ),
);
