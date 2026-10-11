import { useAccountStore } from '@/stores/account-store';
import { useAuthStore } from '@/stores/auth-store';

export function getActiveAccountSlot(): number | null {
  const authState = useAuthStore.getState();
  const accountState = useAccountStore.getState();
  const activeAccountId = authState.activeAccountId ?? accountState.activeAccountId;
  const activeAccount = activeAccountId
    ? accountState.getAccountById(activeAccountId)
    : accountState.getActiveAccount();

  return typeof activeAccount?.cookieSlot === 'number' ? activeAccount.cookieSlot : null;
}

export function getActiveAccountSlotHeaders(): Record<string, string> {
  const slot = getActiveAccountSlot();
  return slot === null ? {} : { 'X-JMAP-Cookie-Slot': String(slot) };
}