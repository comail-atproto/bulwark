import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Regression guard for issue #1766: the Settings → Security password-change
// section must be hidden when the member authenticated via atproto OAuth
// (authMode === 'oauth'), since comail members have no Stalwart password to
// change. It must remain visible for basic (Stalwart password) auth.

const authState: { authMode: 'basic' | 'oauth'; isAuthenticated: boolean; client: unknown } = {
  authMode: 'basic',
  isAuthenticated: true,
  client: { getUsername: () => 'user@example.com' },
};

const securityState = {
  isStalwart: true as boolean | null,
  isProbing: false,
  probe: vi.fn(async () => true),
  fetchAll: vi.fn(),
  fetchAuthInfo: vi.fn(),
  changePassword: vi.fn(),
  isSaving: false,
  displayName: 'User',
  updateDisplayName: vi.fn(),
  isLoadingPrincipal: false,
  otpEnabled: false,
  enableTotp: vi.fn(),
  disableTotp: vi.fn(),
  isLoadingAuth: false,
  appPasswords: [],
  apiKeys: [],
  publicKeys: [],
  createAppPassword: vi.fn(),
  removeAppPassword: vi.fn(),
  createApiKey: vi.fn(),
  removeApiKey: vi.fn(),
  createPublicKey: vi.fn(),
  removePublicKey: vi.fn(),
  updateEncryptionAtRest: vi.fn(),
  encryptionConfig: { type: 'Disabled' as const },
  encryptionType: 'Disabled',
  isLoadingCrypto: false,
};

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    (t as unknown as { raw: (k: string) => string }).raw = (key: string) => key;
    return t;
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,') } }));
vi.mock('otpauth', () => ({ TOTP: class {}, Secret: class {} }));

vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  getPathPrefix: () => '',
}));

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/email-sanitization', () => ({
  sanitizeI18nHtml: (s: string) => s,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/stores/account-store', () => ({
  useAccountStore: Object.assign(
    () => ({}),
    { getState: () => ({ getActiveAccount: () => ({ cookieSlot: 0 }) }) },
  ),
}));

vi.mock('@/stores/account-security-store', () => ({
  useAccountSecurityStore: () => securityState,
}));

import { AccountSecuritySettings } from '@/components/settings/account-security-settings';

describe('Settings → Security password-change gating (issue #1766)', () => {
  beforeEach(() => {
    cleanup();
    authState.authMode = 'basic';
    securityState.isStalwart = true;
  });

  it('shows the password-change section for basic (Stalwart password) auth', () => {
    authState.authMode = 'basic';
    render(<AccountSecuritySettings />);
    expect(screen.queryByText('password.title')).not.toBeNull();
  });

  it('hides the password-change section for atproto OAuth auth', () => {
    authState.authMode = 'oauth';
    render(<AccountSecuritySettings />);
    expect(screen.queryByText('password.title')).toBeNull();
  });
});
