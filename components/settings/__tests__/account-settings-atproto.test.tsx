import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accountState, authState } = vi.hoisted(() => ({
  accountState: {
    accounts: [] as Array<Record<string, unknown>>,
    setDefaultAccount: vi.fn(),
    reorderAccounts: vi.fn(),
    getAccountById: vi.fn(),
  },
  authState: {
    username: 'alice@example.com',
    serverUrl: 'https://mail.example.com',
    isDemoMode: false,
    primaryIdentity: { name: 'Alice', email: 'alice@example.com' },
    authMode: 'basic',
    client: null,
    activeAccountId: null as string | null,
    switchAccount: vi.fn(async () => {}),
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector?: (state: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));
vi.mock('@/stores/account-store', () => ({
  useAccountStore: (selector: (state: typeof accountState) => unknown) => selector(accountState),
}));
vi.mock('@/stores/email-store', () => ({
  useEmailStore: () => ({ quota: null }),
}));
vi.mock('@/stores/managed-account-store', () => ({
  useManagedAccountStore: (selector: (state: { setManagedAccount: () => void }) => unknown) =>
    selector({ setManagedAccount: vi.fn() }),
}));
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ did }: { did?: string }) => <span data-testid="account-avatar" data-did={did} />,
}));
vi.mock('@/components/ui/atproto-handle', () => ({
  AtprotoHandle: ({ did }: { did?: string }) =>
    did ? <span data-testid="account-handle" data-did={did}>@alice.example.com</span> : null,
}));

import { AccountSettings } from '../account-settings';

const DID = 'did:plc:abc123';
const ACCOUNT = {
  id: 'alice@example.com@mail.example.com',
  label: 'Alice',
  serverUrl: 'https://mail.example.com',
  username: 'alice@example.com',
  authMode: 'basic',
  cookieSlot: 0,
  rememberMe: true,
  displayName: 'Alice',
  email: 'alice@example.com',
  avatarColor: '#123456',
  did: DID,
  lastLoginAt: 1,
  isConnected: true,
  hasError: false,
  isDefault: true,
};

describe('AccountSettings atproto identity', () => {
  beforeEach(() => {
    accountState.accounts = [ACCOUNT];
    accountState.getAccountById.mockReturnValue(ACCOUNT);
    authState.activeAccountId = ACCOUNT.id;
  });

  it('passes the verified DID to the photo and handle in the logged-in account row', () => {
    render(<AccountSettings />);

    expect(screen.getByTestId('account-avatar')).toHaveAttribute('data-did', DID);
    expect(screen.getByTestId('account-handle')).toHaveAttribute('data-did', DID);
    expect(screen.getByText('@alice.example.com')).toBeVisible();
  });
});

describe('AccountSettings headline/email dedup', () => {
  beforeEach(() => {
    authState.activeAccountId = ACCOUNT.id;
  });

  it('hides the duplicate email line in the account row when name equals email', () => {
    const dupAccount = {
      ...ACCOUNT,
      displayName: 'example@example.com',
      email: 'example@example.com',
      label: 'example@example.com',
    };
    accountState.accounts = [dupAccount];
    accountState.getAccountById.mockReturnValue(dupAccount);

    render(<AccountSettings />);

    const emailParas = screen.queryAllByText('example@example.com', { selector: 'p.text-xs' });
    expect(emailParas).toHaveLength(0);
  });

  it('keeps both name and email in the account row when they differ', () => {
    const distinctAccount = {
      ...ACCOUNT,
      displayName: 'Example User',
      email: 'example@example.com',
      label: 'Example User',
    };
    accountState.accounts = [distinctAccount];
    accountState.getAccountById.mockReturnValue(distinctAccount);

    render(<AccountSettings />);

    expect(screen.getAllByText('Example User').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('example@example.com')).toBeVisible();
  });
});
