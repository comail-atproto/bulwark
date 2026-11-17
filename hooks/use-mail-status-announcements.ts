"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useEmailStore } from "@/stores/email-store";
import { useAuthStore } from "@/stores/auth-store";
import { announce } from "@/lib/announce";
import { isFilterEmpty } from "@/lib/jmap/search-utils";
import { localizeMailboxName } from "@/lib/mailbox-label";

/** A folder or search that loads in steps is read out once, after the last. */
const LIST_STATUS_DEBOUNCE_MS = 600;

/**
 * Tells screen reader users what changed in Mail without moving the focus
 * (WCAG 4.1.3):
 *
 * - a folder that finished loading, with how many messages it holds, once
 *   per folder (not again after every refresh);
 * - how many messages a search found;
 * - the "Reconnecting" banner (assertive: nothing works until it is back)
 *   and the rate-limit banner.
 */
export function useMailStatusAnnouncements(): void {
  const tStatus = useTranslations("email_list.status");
  const tSidebar = useTranslations("sidebar");
  const tCommon = useTranslations("common");

  useEffect(() => {
    let lastView: string | null = null;
    let lastSearch: string | null = null;

    const folderName = (s: ReturnType<typeof useEmailStore.getState>): string | null => {
      if (s.isUnifiedView) {
        return s.unifiedRole ? localizeMailboxName(s.unifiedRole, "", (k) => tSidebar(`mailboxes.${k}`)) || null : null;
      }
      if (s.selectedKeyword) return null;
      const mailbox = s.mailboxes.find((m) => m.id === s.selectedMailbox);
      return mailbox ? localizeMailboxName(mailbox.role, mailbox.name, (k) => tSidebar(`mailboxes.${k}`)) : null;
    };

    return useEmailStore.subscribe((s, prev) => {
      // Only when a load has just finished, and finished well.
      if (s.isLoading || !prev.isLoading || s.error) return;
      const view = [s.viewingAccountId ?? "", s.selectedMailbox, s.isUnifiedView ? s.unifiedRole ?? "" : "", s.selectedKeyword ?? ""].join("\u0000");
      const searching = !!s.searchQuery || !isFilterEmpty(s.searchFilters);
      if (searching) {
        const search = `${view}\u0000${s.searchQuery}\u0000${JSON.stringify(s.searchFilters)}`;
        if (search === lastSearch) return;
        lastSearch = search;
        announce(tStatus("search_results", { count: s.totalEmails }), { key: "list-status", debounceMs: LIST_STATUS_DEBOUNCE_MS });
        return;
      }
      lastSearch = null;
      if (view === lastView) return;
      lastView = view;
      const folder = folderName(s);
      if (!folder) return;
      announce(tStatus("folder_loaded", { folder, count: s.totalEmails }), { key: "list-status", debounceMs: LIST_STATUS_DEBOUNCE_MS });
    });
  }, [tStatus, tSidebar]);

  useEffect(() => useAuthStore.subscribe((s, prev) => {
    if (s.connectionLost && !prev.connectionLost) {
      announce(tCommon("reconnecting"), { assertive: true });
    }
    if (s.isRateLimited && !prev.isRateLimited) {
      announce(tCommon("rate_limited_title"));
    }
  }), [tCommon]);
}
