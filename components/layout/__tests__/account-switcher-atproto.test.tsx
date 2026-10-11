import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accountState, authState, routerPush } = vi.hoisted(() => ({
  accountState: {
    accounts: [] as Array<Record<string, unknown>>,
    setDefaultAccount: vi.fn(),
    reorderAccounts: vi.fn(),
  },
  authState: {
    activeAccountId: null as string | null,
    switchAccount: vi.fn(async () => {}),
    logout: vi.fn(),
    logoutAll: vi.fn(),
  },
  routerPush: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));
vi.mock('@/stores/account-store', () => ({
  useAccountStore: (selector: (state: typeof accountState) => unknown) => selector(accountState),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ did }: { did?: string }) => <span data-testid="account-avatar" data-did={did} />,
}));
vi.mock('@/components/ui/atproto-handle', () => ({
  AtprotoHandle: ({ did }: { did?: string }) =>
    did ? <span data-testid="account-handle" data-did={did}>@alice.example.com</span> : null,
}));

import { AccountSwitcher } from '../account-switcher';

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

describe('AccountSwitcher atproto identity', () => {
  beforeEach(() => {
    accountState.accounts = [ACCOUNT];
    authState.activeAccountId = ACCOUNT.id;
  });

  it('passes the verified DID to the photo and handle in the trigger and dropdown row', () => {
    render(<AccountSwitcher variant="expanded" />);

    fireEvent.click(screen.getByRole('button'));

    const avatars = screen.getAllByTestId('account-avatar');
    const handles = screen.getAllByTestId('account-handle');
    expect(avatars).toHaveLength(2);
    expect(handles).toHaveLength(2);
    expect(avatars.every((node) => node.getAttribute('data-did') === DID)).toBe(true);
    expect(handles.every((node) => node.getAttribute('data-did') === DID)).toBe(true);
  });
});

describe('AccountSwitcher headline/email dedup', () => {
  beforeEach(() => {
    authState.activeAccountId = ACCOUNT.id;
  });

  it('hides the duplicate email line in the expanded trigger when name equals email', () => {
    const dupAccount = {
      ...ACCOUNT,
      displayName: 'example@example.com',
      email: 'example@example.com',
      label: 'example@example.com',
    };
    accountState.accounts = [dupAccount];

    render(<AccountSwitcher variant="expanded" />);

    const triggerText = screen.getByText('example@example.com');
    expect(triggerText).toBeVisible();
    const emailParas = screen.queryAllByText('example@example.com', { selector: 'p.text-xs' });
    expect(emailParas).toHaveLength(0);
  });

  it('keeps both name and email in the expanded trigger when they differ', () => {
    const distinctAccount = {
      ...ACCOUNT,
      displayName: 'Example User',
      email: 'example@example.com',
      label: 'Example User',
    };
    accountState.accounts = [distinctAccount];

    render(<AccountSwitcher variant="expanded" />);

    expect(screen.getByText('Example User')).toBeVisible();
    expect(screen.getByText('example@example.com')).toBeVisible();
  });

  it('hides the duplicate email line in the dropdown row when name equals email', () => {
    const dupAccount = {
      ...ACCOUNT,
      displayName: 'example@example.com',
      email: 'example@example.com',
      label: 'example@example.com',
    };
    accountState.accounts = [dupAccount];

    render(<AccountSwitcher variant="expanded" />);
    fireEvent.click(screen.getByRole('button'));

    const emailParas = screen.queryAllByText('example@example.com', { selector: 'p.text-xs' });
    expect(emailParas).toHaveLength(0);
  });

  it('keeps both name and email in the dropdown row when they differ', () => {
    const distinctAccount = {
      ...ACCOUNT,
      displayName: 'Example User',
      email: 'example@example.com',
      label: 'Example User',
    };
    accountState.accounts = [distinctAccount];

    render(<AccountSwitcher variant="expanded" />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getAllByText('Example User').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('example@example.com').length).toBeGreaterThanOrEqual(1);
  });
});
