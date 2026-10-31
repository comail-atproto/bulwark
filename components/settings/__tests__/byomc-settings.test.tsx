import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ByomcSettings } from '../byomc-settings';

/**
 * BYOMC settings tests (atmosphere-mail #1791).
 *
 * Covers:
 *  - the connection card renders the operator-configured IMAP/SMTP hosts +
 *    ports + the logged-in email (username).
 *  - when IMAP_HOST/SMTP_HOST are empty, the config-missing notice renders
 *    and no host/port rows do.
 *  - the app-password block is absent when APP_PASSWORD_API_URL is empty
 *    (no dead buttons).
 *  - the mint happy path: POST → dialog shows the password exactly once.
 *
 * vi.mock factories are written with vi.hoisted so they never reference
 * top-level consts (a prior PR hit the TDZ trap where the factory closure
 * captured a `let`/`const` before its initialization).
 */

// Shape of the config slice ByomcSettings consumes.
interface ByomcConfig {
  byomcEnabled: boolean;
  byomcImapHost: string;
  byomcSmtpHost: string;
  byomcAppPasswordApiUrl: string;
}

const DEFAULT_CONFIG: ByomcConfig = {
  byomcEnabled: true,
  byomcImapHost: 'imap.example.com',
  byomcSmtpHost: 'smtp.example.com',
  byomcAppPasswordApiUrl: '',
};

// Hoisted so the mock factory can read it without TDZ. The factory runs at
// import time, before any test mutates config — but the returned object is a
// *function* (`useConfig`), so tests mutate `currentConfig` and re-render.
const { currentConfig, setCurrentConfig } = vi.hoisted(() => {
  let cfg: ByomcConfig = {
    byomcEnabled: true,
    byomcImapHost: 'imap.example.com',
    byomcSmtpHost: 'smtp.example.com',
    byomcAppPasswordApiUrl: '',
  };
  return {
    currentConfig: () => cfg,
    setCurrentConfig: (next: Partial<ByomcConfig>) => {
      cfg = { ...cfg, ...next };
    },
  };
});

vi.mock('@/hooks/use-config', () => ({
  useConfig: () => currentConfig(),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    primaryIdentity: { email: 'operator@example.com' },
    username: 'operator@example.com',
  }),
}));

// Toast store: capture addToast calls so we can assert error paths without a
// rendered toast portal.
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/stores/toast-store', () => ({
  useToastStore: (selector: (s: { addToast: typeof toastSpy }) => unknown) =>
    selector({ addToast: toastSpy }),
}));

// apiFetch mock — hoisted so the factory can return it. Tests override
// fetchMock implementation per-case.
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: (...args: unknown[]) => fetchMock(...args),
}));

// useFocusTrap returns a ref object; stub it so dialogs render without DOM.
vi.mock('@/hooks/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

// useConfirmDialog: hoisted confirm mock so the revoke test can flip it to
// resolve(true). Defaults to resolve(false) so non-revoke tests don't trip it.
const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('@/hooks/use-confirm-dialog', () => ({
  useConfirmDialog: () => ({
    dialogProps: { isOpen: false, onClose: vi.fn(), onConfirm: vi.fn(), title: '', message: '' },
    confirm: confirmMock,
  }),
}));

// SettingsSection renders children verbatim (data-search-label on the wrapper
// is harmless). Avoid pulling in the real component's layout.
vi.mock('../settings-section', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="settings-section">{children}</div>
  ),
}));

// Override the global next-intl mock (from vitest.setup.ts) with a STABLE
// translator. The setup mock returns `(key) => key` but creates a new function
// each call, which breaks referential equality of `t` across renders. ByomcSettings
// memoizes callbacks on `[t]`; an unstable `t` would recreate them every render
// and re-fire mount effects → infinite loop → worker OOM. Real next-intl returns a
// stable translator, so this mirrors production behavior.
const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('next-intl', () => ({
  useTranslations: () => stableT,
  useLocale: () => 'en',
  useFormatter: () => ({
    dateTime: (d: Date | string) => String(d),
    relativeTime: (d: Date | string) => String(d),
    number: (n: number) => String(n),
  }),
}));

describe('ByomcSettings', () => {
  beforeEach(() => {
    setCurrentConfig({ ...DEFAULT_CONFIG });
    fetchMock.mockReset();
    toastSpy.mockClear();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the connection card with configured hosts, ports, and the username', () => {
    render(<ByomcSettings />);

    // IMAP host + port
    expect(screen.getByDisplayValue('imap.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('993')).toBeInTheDocument();
    // SMTP host + port
    expect(screen.getByDisplayValue('smtp.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('465')).toBeInTheDocument();
    // Username = logged-in email
    expect(screen.getByDisplayValue('operator@example.com')).toBeInTheDocument();
  });

  it('shows the config-missing notice when both hosts are empty', () => {
    setCurrentConfig({ byomcImapHost: '', byomcSmtpHost: '' });
    render(<ByomcSettings />);

    expect(screen.getByText('config_missing_title')).toBeInTheDocument();
    expect(screen.getByText('config_missing_description')).toBeInTheDocument();
    // No host/port rows render.
    expect(screen.queryByDisplayValue('993')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('465')).not.toBeInTheDocument();
  });

  it('renders only IMAP rows when SMTP host is empty', () => {
    setCurrentConfig({ byomcSmtpHost: '' });
    render(<ByomcSettings />);

    expect(screen.getByDisplayValue('imap.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('993')).toBeInTheDocument();
    // SMTP absent
    expect(screen.queryByDisplayValue('465')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('smtp.example.com')).not.toBeInTheDocument();
  });

  it('omits the app-password block when APP_PASSWORD_API_URL is empty', () => {
    render(<ByomcSettings />);

    // The passwords block title key must NOT render.
    expect(screen.queryByText('passwords.title')).not.toBeInTheDocument();
    expect(screen.queryByText('passwords.mint')).not.toBeInTheDocument();
    // No fetch should have been attempted against an app-password API.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the app-password block and loads existing passwords when the URL is set', async () => {
    setCurrentConfig({ byomcAppPasswordApiUrl: 'https://ap.example.com' });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'pw-1', label: 'Thunderbird', createdAt: '2026-01-01' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<ByomcSettings />);

    expect(screen.getByText('passwords.title')).toBeInTheDocument();
    expect(screen.getByText('passwords.mint')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Thunderbird')).toBeInTheDocument();
    });
    expect(screen.getByText(/pw-1/)).toBeInTheDocument();
  });

  it('mints an app password and shows it exactly once in the copy-once dialog', async () => {
    setCurrentConfig({ byomcAppPasswordApiUrl: 'https://ap.example.com' });
    // Initial list load returns empty.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // POST mint returns the cleartext password exactly once.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pw-2', password: 's3cret-once' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // Refresh after mint.
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'pw-2', label: 'Thunderbird' }]), { status: 200 }),
      );

    render(<ByomcSettings />);

    const mintButton = screen.getByText('passwords.mint');
    await act(async () => {
      fireEvent.click(mintButton);
    });

    // The minted password appears in the copy-once dialog input.
    await waitFor(() => {
      expect(screen.getByDisplayValue('s3cret-once')).toBeInTheDocument();
    });

    // A success toast fired.
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'passwords.minted' }),
    );

    // POST was the second call (after the initial GET list).
    const postCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const postUrl = String(postCall![0]);
    expect(postUrl).toContain('https://ap.example.com');
  });

  it('toasts an error and clears minting when the mint request fails', async () => {
    setCurrentConfig({ byomcAppPasswordApiUrl: 'https://ap.example.com' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));

    render(<ByomcSettings />);

    await act(async () => {
      fireEvent.click(screen.getByText('passwords.mint'));
    });

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'passwords.mint_failed' }),
      );
    });
    // No copy-once dialog value rendered.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('revokes a password via DELETE on confirm', async () => {
    setCurrentConfig({ byomcAppPasswordApiUrl: 'https://ap.example.com' });
    confirmMock.mockResolvedValueOnce(true);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'pw-1', label: 'Thunderbird' }]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 })) // DELETE
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 })); // refresh

    render(<ByomcSettings />);

    await waitFor(() => {
      expect(screen.getByText('Thunderbird')).toBeInTheDocument();
    });

    // The revoke button is the destructive button with the revoke aria label.
    const revokeBtn = screen.getByLabelText('passwords.revoke_aria');
    await act(async () => {
      fireEvent.click(revokeBtn);
    });

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', title: 'passwords.revoked' }),
      );
    });

    const deleteCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
    expect(String(deleteCall![0])).toContain('https://ap.example.com/pw-1');
  });
});
