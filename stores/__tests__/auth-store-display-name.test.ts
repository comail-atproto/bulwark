import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stalwart/principal', () => ({
  fetchPrincipalDisplayName: vi.fn(),
}));

import { syncAccountDisplayName } from '../auth-store';
import { useAccountStore } from '../account-store';
import { fetchPrincipalDisplayName } from '@/lib/stalwart/principal';

const mockedPrincipal = fetchPrincipalDisplayName as unknown as ReturnType<typeof vi.fn>;

const SERVER = 'https://mail.example.com';
const client = {} as never;

function seedAccount(displayName = 'Old Name', label = displayName): string {
  const store = useAccountStore.getState();
  const id = store.addAccount({
    label,
    serverUrl: SERVER,
    username: 'user@example.com',
    authMode: 'basic',
    rememberMe: true,
    displayName,
    email: 'user@example.com',
    lastLoginAt: 0,
    isConnected: true,
    hasError: false,
    isDefault: true,
  });
  return id;
}

// Issue #900: the registry entry is written once by addAccount and never
// refreshed, so a Stalwart admin renaming the user ("Full name") was never
// reflected in the account switcher / settings header.
describe('syncAccountDisplayName (#900)', () => {
  beforeEach(() => {
    mockedPrincipal.mockReset();
    useAccountStore.setState({ accounts: [], activeAccountId: null, defaultAccountId: null });
  });

  it('replaces the cached name with the live Stalwart principal name', async () => {
    const id = seedAccount('Old Name');
    mockedPrincipal.mockResolvedValueOnce('New Name');

    await syncAccountDisplayName(id, client, 'Old Name');

    const account = useAccountStore.getState().getAccountById(id)!;
    expect(account.displayName).toBe('New Name');
    expect(account.label).toBe('New Name');
    expect(mockedPrincipal).toHaveBeenCalledWith(client, account.cookieSlot);
  });

  it('falls back to the identity name when the principal is unavailable', async () => {
    const id = seedAccount('Old Name');
    mockedPrincipal.mockResolvedValueOnce(null);

    await syncAccountDisplayName(id, client, 'Identity Name');

    expect(useAccountStore.getState().getAccountById(id)!.displayName).toBe('Identity Name');
  });

  it('keeps the cached name when neither source yields one', async () => {
    const id = seedAccount('Old Name');
    mockedPrincipal.mockResolvedValueOnce(null);

    await syncAccountDisplayName(id, client, '   ');

    expect(useAccountStore.getState().getAccountById(id)!.displayName).toBe('Old Name');
  });

  it('leaves a diverged label alone', async () => {
    const id = seedAccount('Old Name', 'Work');
    mockedPrincipal.mockResolvedValueOnce('New Name');

    await syncAccountDisplayName(id, client);

    const account = useAccountStore.getState().getAccountById(id)!;
    expect(account.displayName).toBe('New Name');
    expect(account.label).toBe('Work');
  });

  it('is a no-op for unknown accounts and for unchanged names', async () => {
    await syncAccountDisplayName('missing', client, 'Whatever');
    expect(mockedPrincipal).not.toHaveBeenCalled();

    const id = seedAccount('Same');
    mockedPrincipal.mockResolvedValueOnce('Same');
    const before = useAccountStore.getState().getAccountById(id);
    await syncAccountDisplayName(id, client);
    expect(useAccountStore.getState().getAccountById(id)).toBe(before);
  });
});
