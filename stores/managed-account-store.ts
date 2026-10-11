import { create } from 'zustand';
import type { SharedAccount } from '@/lib/jmap/types';

/**
 * Tracks which account the settings panel is currently scoped to. `null` means
 * the user's own (primary) account — the default, full settings view. When set
 * to a shared/group account, the settings panel enters "scoped mode": a reduced
 * tab list and a "Managing: <name>" header, and the account-scoped settings
 * pages (filters, vacation, calendars, contacts) read `managedAccountId` to
 * target that account.
 *
 * This is session-only navigation state (not persisted) so a shared-account
 * context never leaks across reloads or logout.
 */
interface ManagedAccountStore {
  managedAccountId: string | null;
  managedAccount: SharedAccount | null;

  /** Enter scoped mode for `account`, or pass `null` to return to own account. */
  setManagedAccount: (account: SharedAccount | null) => void;
  clear: () => void;
}

export const useManagedAccountStore = create<ManagedAccountStore>()((set) => ({
  managedAccountId: null,
  managedAccount: null,

  setManagedAccount: (account) =>
    set({ managedAccountId: account?.id ?? null, managedAccount: account }),

  clear: () => set({ managedAccountId: null, managedAccount: null }),
}));
