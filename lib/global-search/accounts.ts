import { useAccountStore } from '@/stores/account-store';
import { useAuthStore } from '@/stores/auth-store';
import type { SearchAccount } from '@/lib/global-search/types';

/**
 * Every login the global search fans out to. Shared/delegated JMAP accounts
 * inside a login are handled by the per-kind enumerators the providers call
 * (`buildUnifiedAccountClients`, `searchContacts`, `queryAllCalendarEvents`,
 * `listAllFileNodesAcrossAccounts`), so this only lists logins.
 */
export function getSearchAccounts(): SearchAccount[] {
  const { accounts } = useAccountStore.getState();
  const { getClientForAccount, client: activeClient, activeAccountId } = useAuthStore.getState();
  const out: SearchAccount[] = [];
  for (const account of accounts) {
    if (!account.isConnected) continue;
    const client = getClientForAccount(account.id) ?? (account.id === activeAccountId ? activeClient : null);
    if (!client) continue;
    out.push({
      localAccountId: account.id,
      label: account.label || account.email,
      email: account.email,
      client,
      serverUrl: account.serverUrl,
    });
  }
  // A session without account-store entries (demo, tests): search the active client alone.
  if (out.length === 0 && activeClient && activeAccountId) {
    out.push({ localAccountId: activeAccountId, label: activeAccountId, email: activeAccountId, client: activeClient });
  }
  return out;
}

export function getActiveLocalAccountId(): string | null {
  return useAuthStore.getState().activeAccountId;
}

export function indexAccounts(accounts: SearchAccount[]): Map<string, SearchAccount> {
  return new Map(accounts.map((account) => [account.localAccountId, account]));
}
