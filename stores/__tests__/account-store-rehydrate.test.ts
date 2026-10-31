import { beforeEach, describe, expect, it } from 'vitest';
import { useAccountStore } from '../account-store';

/**
 * `isConnected` / `hasError` describe a live JMAP client, which cannot survive a
 * page load - but the whole account entry is persisted, so a fresh tab used to
 * rehydrate them as still-connected. The unified mailbox filters on
 * `isConnected` and silently drops accounts whose client is not in the map yet,
 * and the effects keyed on the connected-accounts signature never re-fired
 * because the signature already looked complete at mount. See #950.
 */
function seedStorage(accounts: Array<Record<string, unknown>>) {
  localStorage.setItem(
    'account-registry',
    JSON.stringify({
      state: { accounts, activeAccountId: accounts[0]?.id ?? null, defaultAccountId: null },
      version: 0,
    }),
  );
}

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    cookieSlot: 0,
    username: `${id}@example.org`,
    serverUrl: 'https://mail.example.org',
    displayName: id,
    email: `${id}@example.org`,
    avatarColor: '#123456',
    lastLoginAt: 1_700_000_000_000,
    isConnected: true,
    hasError: false,
    isDefault: false,
    ...overrides,
  };
}

describe('account-store rehydrate (#950)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears persisted isConnected so it reflects this session, not the last one', async () => {
    seedStorage([entry('alice'), entry('bob')]);

    await useAccountStore.persist.rehydrate();

    const { accounts } = useAccountStore.getState();
    expect(accounts).toHaveLength(2);
    // Neither client has connected in this session yet.
    expect(accounts.every((a) => a.isConnected === false)).toBe(true);
  });

  it('clears a persisted error state so a stale failure does not stick', async () => {
    seedStorage([
      entry('alice', { isConnected: false, hasError: true, errorMessage: 'Temporarily rate limited by server' }),
    ]);

    await useAccountStore.persist.rehydrate();

    const alice = useAccountStore.getState().accounts[0];
    expect(alice.hasError).toBe(false);
    expect(alice.errorMessage).toBeUndefined();
  });

  it('preserves every other field of the entry', async () => {
    seedStorage([entry('alice', { displayName: 'Alice A', cookieSlot: 3, isDefault: true })]);

    await useAccountStore.persist.rehydrate();

    const alice = useAccountStore.getState().accounts[0];
    expect(alice.id).toBe('alice');
    expect(alice.displayName).toBe('Alice A');
    expect(alice.cookieSlot).toBe(3);
    expect(alice.isDefault).toBe(true);
    expect(alice.email).toBe('alice@example.org');
    expect(alice.serverUrl).toBe('https://mail.example.org');
    expect(alice.lastLoginAt).toBe(1_700_000_000_000);
  });

  it('leaves the active/default account selection alone', async () => {
    seedStorage([entry('alice'), entry('bob')]);

    await useAccountStore.persist.rehydrate();

    expect(useAccountStore.getState().activeAccountId).toBe('alice');
  });

  it('is a no-op for an empty registry', async () => {
    seedStorage([]);

    await useAccountStore.persist.rehydrate();

    expect(useAccountStore.getState().accounts).toEqual([]);
  });
});
