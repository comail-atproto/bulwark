"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSearchAccounts } from '@/lib/global-search/accounts';
import { GLOBAL_SEARCH_PROVIDERS } from '@/lib/global-search/providers';
import { parseSearchQuery, type ParsedQuery, type SearchScope } from '@/lib/global-search/query-parser';
import { mergeHits, rankHits } from '@/lib/global-search/rank';
import { hasRemoteQuery, runGlobalSearch } from '@/lib/global-search/run-global-search';
import {
  emptyOutcome,
  type SearchAccount,
  type SearchKind,
  type SearchOutcome,
  type SearchProvider,
} from '@/lib/global-search/types';

export interface UseGlobalSearchOptions {
  query: string;
  /** Scope chip; an explicit `in:` in the query wins over it. */
  scope: SearchScope;
  /** Account chip (`AccountEntry.id`); null = every login. */
  accountId: string | null;
  /** Hits per kind from the local caches. */
  localLimit: number;
  /** Hits per kind per login from the server. */
  remoteLimit: number;
  /** Delay before the server pass; the local pass runs immediately. */
  debounceMs?: number;
  enabled?: boolean;
  /** Injection point for tests. */
  providers?: readonly SearchProvider[];
  accounts?: () => SearchAccount[];
}

export interface UseGlobalSearchResult {
  parsed: ParsedQuery;
  outcome: SearchOutcome;
  /** Any kind still waiting on a server response. */
  isSearching: boolean;
  /** True when the query has nothing to search for (empty, or operators only with no server-side meaning). */
  isEmpty: boolean;
  /** Re-run the server pass now (Enter in the palette, refresh in the tab). */
  rerun: () => void;
  /** Mail pagination for the search tab: fetches the next page and appends. */
  loadMoreMail: () => void;
  mailLimit: number;
}

/**
 * Runs a global search for a query and keeps the merged outcome up to date:
 * local cache hits synchronously on every keystroke, server hits after the
 * debounce, partial results published as each login answers. Stale responses
 * are dropped by search id, so a fast typist never sees results for an
 * earlier query flash in.
 */
export function useGlobalSearch(options: UseGlobalSearchOptions): UseGlobalSearchResult {
  const {
    query, scope, accountId, localLimit, remoteLimit,
    debounceMs = 300, enabled = true,
    providers = GLOBAL_SEARCH_PROVIDERS,
    accounts: accountsSource = getSearchAccounts,
  } = options;

  const parsed = useMemo(() => {
    const base = parseSearchQuery(query);
    return base.scope === 'all' && scope !== 'all' ? { ...base, scope } : base;
  }, [query, scope]);

  const [outcome, setOutcome] = useState<SearchOutcome>(emptyOutcome);
  const [mailLimit, setMailLimit] = useState(remoteLimit);
  const [runToken, setRunToken] = useState(0);
  const searchIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;

  const resolveAccounts = useCallback(() => {
    const all = accountsSource();
    return accountId ? all.filter((a) => a.localAccountId === accountId) : all;
  }, [accountsSource, accountId]);

  const hasAnything = parsed.terms.length > 0
    || (['mail', 'contacts', 'calendar', 'files'] as SearchKind[]).some((kind) => hasRemoteQuery(parsed, kind));
  const isEmpty = !hasAnything;

  // Reset pagination whenever the query itself changes.
  useEffect(() => {
    setMailLimit(remoteLimit);
  }, [query, scope, accountId, remoteLimit]);

  useEffect(() => {
    controllerRef.current?.abort();
    const searchId = ++searchIdRef.current;
    if (!enabled || isEmpty) {
      setOutcome(emptyOutcome());
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const accounts = resolveAccounts();

    // Instant pass: whatever the caches already hold, no round-trip.
    const local = emptyOutcome();
    for (const provider of providers) {
      if (parsed.scope !== 'all' && provider.kind !== parsed.scope) continue;
      if (parsed.terms.length > 0) {
        try {
          local.hits[provider.kind] = rankHits(mergeHits([], provider.local(parsed, accounts, localLimit)), parsed);
        } catch {
          // A cache mid-mutation must not break typing; the server pass follows.
        }
      }
      const willAsk = hasRemoteQuery(parsed, provider.kind) && accounts.some((a) => provider.supports(a));
      local.status[provider.kind].status = willAsk ? 'loading' : 'done';
    }
    setOutcome(local);

    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      void runGlobalSearch({
        parsed,
        accounts,
        providers: [...providers],
        localLimit,
        remoteLimit: mailLimit > remoteLimit ? mailLimit : remoteLimit,
        signal: controller.signal,
        onUpdate: (next) => {
          if (searchId !== searchIdRef.current) return;
          setOutcome(next);
        },
      });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `mailLimit` intentionally drives re-runs through loadMoreMail (rerun via runToken).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, enabled, isEmpty, resolveAccounts, providers, localLimit, remoteLimit, debounceMs, runToken]);

  const rerun = useCallback(() => setRunToken((n) => n + 1), []);

  const loadMoreMail = useCallback(() => {
    const nextLimit = mailLimit + remoteLimit;
    setMailLimit(nextLimit);
    const controller = new AbortController();
    const searchId = searchIdRef.current;
    const accounts = resolveAccounts();
    const mailProviders = providers.filter((p) => p.kind === 'mail');
    void runGlobalSearch({
      parsed,
      accounts,
      providers: [...mailProviders],
      localLimit,
      remoteLimit: nextLimit,
      includeLocal: false,
      signal: controller.signal,
      onUpdate: (next) => {
        if (searchId !== searchIdRef.current) return;
        const current = outcomeRef.current;
        setOutcome({
          hits: { ...current.hits, mail: rankHits(mergeHits(current.hits.mail, next.hits.mail), parsed) },
          status: { ...current.status, mail: next.status.mail },
        });
      },
    });
  }, [mailLimit, remoteLimit, resolveAccounts, providers, parsed, localLimit]);

  const isSearching = Object.values(outcome.status).some((s) => s.status === 'loading');

  return { parsed, outcome, isSearching, isEmpty, rerun, loadMoreMail, mailLimit };
}
