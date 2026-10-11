"use client";

import { useTranslations } from "next-intl";
import type { SearchScope } from "@/lib/global-search/query-parser";
import { cn } from "@/lib/utils";

export interface ScopeAccountOption {
  localAccountId: string;
  label: string;
}

export interface SearchScopeChipsProps {
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  accounts: ScopeAccountOption[];
  accountId: string | null;
  onAccountChange: (accountId: string | null) => void;
}

const SCOPES: readonly SearchScope[] = ['all', 'mail', 'contacts', 'calendar', 'files'];

/**
 * Scope + account chips of the global search palette. They are sugar over the
 * `in:` / `account:` query operators - an explicit operator in the query wins.
 */
export function SearchScopeChips({ scope, onScopeChange, accounts, accountId, onAccountChange }: SearchScopeChipsProps) {
  const t = useTranslations('global_search');
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div role="radiogroup" aria-label={t('scope_label')} className="flex items-center gap-1">
        {SCOPES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={scope === option}
            onClick={() => onScopeChange(option)}
            className={cn(
              "px-2 py-0.5 rounded-full text-xs border transition-colors cursor-pointer",
              scope === option
                ? "bg-primary/10 border-primary/40 text-primary font-medium"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`scope_${option}`)}
          </button>
        ))}
      </div>
      {accounts.length > 1 && (
        <select
          aria-label={t('account_label')}
          value={accountId ?? ''}
          onChange={(e) => onAccountChange(e.target.value || null)}
          className="ml-auto max-w-[14rem] truncate text-xs bg-transparent border border-border rounded-full px-2 py-0.5 text-muted-foreground cursor-pointer focus:outline-none focus:border-primary/40"
        >
          <option value="">{t('all_accounts')}</option>
          {accounts.map((account) => (
            <option key={account.localAccountId} value={account.localAccountId}>{account.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
