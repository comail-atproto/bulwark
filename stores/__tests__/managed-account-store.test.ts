import { describe, it, expect, beforeEach } from 'vitest';
import { useManagedAccountStore } from '../managed-account-store';
import type { SharedAccount } from '@/lib/jmap/types';

const sharedAccount: SharedAccount = {
  id: 'group-1',
  name: 'Sales',
  isPrimary: false,
  capabilities: { mail: true, sieve: true, calendars: true, contacts: true, filenode: false },
};

describe('managed-account-store', () => {
  beforeEach(() => {
    useManagedAccountStore.getState().clear();
  });

  it('defaults to no managed account (own account)', () => {
    expect(useManagedAccountStore.getState().managedAccountId).toBeNull();
    expect(useManagedAccountStore.getState().managedAccount).toBeNull();
  });

  it('setManagedAccount enters scoped mode for the account', () => {
    useManagedAccountStore.getState().setManagedAccount(sharedAccount);
    expect(useManagedAccountStore.getState().managedAccountId).toBe('group-1');
    expect(useManagedAccountStore.getState().managedAccount).toEqual(sharedAccount);
  });

  it('setManagedAccount(null) and clear() return to the own account', () => {
    useManagedAccountStore.getState().setManagedAccount(sharedAccount);
    useManagedAccountStore.getState().setManagedAccount(null);
    expect(useManagedAccountStore.getState().managedAccountId).toBeNull();
    expect(useManagedAccountStore.getState().managedAccount).toBeNull();

    useManagedAccountStore.getState().setManagedAccount(sharedAccount);
    useManagedAccountStore.getState().clear();
    expect(useManagedAccountStore.getState().managedAccountId).toBeNull();
  });
});
