"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './settings-section';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useConfig } from '@/hooks/use-config';
import { useAuthStore } from '@/stores/auth-store';
import { useToastStore } from '@/stores/toast-store';
import { apiFetch } from '@/lib/browser-navigation';
import { cn } from '@/lib/utils';

/**
 * BYOMC — "bring your own mail client" (atmosphere-mail #1791).
 *
 * Renders the connection details a user plugs into Thunderbird / Apple Mail /
 * etc. to read+send Comail from a third-party client. IMAP/SMTP host+port are
 * shown verbatim from operator config; the username is the logged-in account's
 * primary email. When APP_PASSWORD_API_URL is set, an app-password management
 * block (list/mint/revoke) is rendered against it; when it's empty (Comail
 * today), the block is absent — no dead buttons.
 */

const IMAP_PORT = 993; // IMAPS — implicit TLS
const SMTP_PORT = 465; // SMTPS — implicit TLS submission

interface AppPassword {
  id: string;
  /** Optional human label the operator's API returned (e.g. "Thunderbird"). */
  label?: string;
  /** ISO timestamp of creation, if the API returned one. */
  createdAt?: string;
}

type PasswordListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; passwords: AppPassword[] }
  | { kind: 'error'; message: string };

type MintState =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'minted'; password: string; label: string };

function normalizeApiUrl(raw: string): string {
  return (raw ?? '').trim();
}

/** Build the absolute request URL for a relative or absolute API path. */
function buildRequestUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(path)) return path;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${suffix}`;
}

/**
 * Copy `text` to the clipboard and surface success/failure via the toast
 * store. Falls back to a transient boolean the caller can render.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Connection card: IMAP + SMTP endpoints, the logged-in email as username,
 * and copy buttons. When neither host is configured, shows an operator-facing
 * config-missing notice instead of deriving anything from the JMAP URL.
 */
function ConnectionCard({
  imapHost,
  smtpHost,
  email,
}: {
  imapHost: string;
  smtpHost: string;
  email: string;
}) {
  const t = useTranslations('settings.byomc');
  const addToast = useToastStore((s) => s.addToast);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const hasImap = imapHost.length > 0;
  const hasSmtp = smtpHost.length > 0;
  const hasAnyHost = hasImap || hasSmtp;
  const hasEmail = email.length > 0;

  const handleCopy = useCallback(
    async (key: string, value: string) => {
      const ok = await copyToClipboard(value);
      if (ok) {
        setCopiedKey(key);
        addToast({ type: 'success', title: t('copied') });
        setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
      } else {
        addToast({ type: 'error', title: t('copy_failed') });
      }
    },
    [addToast, t],
  );

  if (!hasAnyHost) {
    // Operator-facing wording: this is shown to end users but the action is on
    // the operator, not the user. We do NOT derive hosts from the JMAP URL —
    // deriving would silently point third-party clients at a host that may not
    // actually serve IMAP/SMTP.
    return (
      <div className="flex items-start gap-3 p-3 rounded-md border border-dashed border-border bg-muted/40">
        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t('config_missing_title')}</p>
          <p className="text-xs text-muted-foreground">{t('config_missing_description')}</p>
        </div>
      </div>
    );
  }

  const rows = [
    {
      key: 'imap_host',
      label: t('imap_host_label'),
      value: imapHost,
      visible: hasImap,
    },
    {
      key: 'imap_port',
      label: t('imap_port_label'),
      value: String(IMAP_PORT),
      visible: hasImap,
    },
    {
      key: 'smtp_host',
      label: t('smtp_host_label'),
      value: smtpHost,
      visible: hasSmtp,
    },
    {
      key: 'smtp_port',
      label: t('smtp_port_label'),
      value: String(SMTP_PORT),
      visible: hasSmtp,
    },
    {
      key: 'username',
      label: t('username_label'),
      value: hasEmail ? email : t('username_unknown'),
      visible: true,
    },
  ].filter((r) => r.visible);

  return (
    <div data-search-label={t('connection_title')} className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium text-foreground">{t('connection_title')}</h4>
      </div>
      <p className="text-xs text-muted-foreground">{t('connection_description')}</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key}>
            <label className="text-xs text-muted-foreground mb-1 block">{row.label}</label>
            <div className="flex rounded-lg">
              <input
                type="text"
                readOnly
                value={row.value}
                aria-label={row.label}
                className="py-2 px-3 block w-full bg-background border border-border border-e-transparent rounded-s-lg text-sm text-foreground focus:z-10 focus:border-ring focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => handleCopy(row.key, row.value)}
                aria-label={t('copy_aria', { label: row.label })}
                className="h-[38px] px-3 shrink-0 inline-flex items-center gap-1.5 rounded-e-lg border border-border bg-muted text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {copiedKey === row.key ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiedKey === row.key ? t('copied') : t('copy')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground pt-1">{t('tls_note')}</p>
    </div>
  );
}

/** Collapsible per-client setup hints (Thunderbird, Apple Mail). */
function ClientHints() {
  const t = useTranslations('settings.byomc');
  const [open, setOpen] = useState(false);

  const hints = useMemo(
    () => [
      { id: 'thunderbird', label: t('clients.thunderbird'), body: t('clients.thunderbird_steps') },
      { id: 'apple_mail', label: t('clients.apple_mail'), body: t('clients.apple_mail_steps') },
    ],
    [t],
  );

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="font-medium">{t('hints_title')}</span>
        <ChevronDown
          className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          {hints.map((hint) => (
            <div key={hint.id} className="space-y-1">
              <p className="text-xs font-semibold text-foreground">{hint.label}</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{hint.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * App-password block. Rendered ONLY when the operator configured
 * APP_PASSWORD_API_URL. Mirrors the webmail session credential pattern: the
 * section is served same-origin via the webmail, so cookies travel with the
 * request and we use credentials:'include'. The API contract is:
 *   GET    /        → list passwords
 *   POST   /        → mint  (returns the cleartext password exactly once)
 *   DELETE /:id     → revoke
 */
function AppPasswordBlock({ apiUrl }: { apiUrl: string }) {
  const t = useTranslations('settings.byomc');
  const addToast = useToastStore((s) => s.addToast);

  const [state, setState] = useState<PasswordListState>({ kind: 'idle' });
  const [mint, setMint] = useState<MintState>({ kind: 'idle' });
  const [mintLabel, setMintLabel] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { dialogProps: confirmDialogProps, confirm: confirmRevoke } = useConfirmDialog();

  const baseUrl = useMemo(() => normalizeApiUrl(apiUrl), [apiUrl]);

  const listPasswords = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await apiFetch(buildRequestUrl(baseUrl, '/'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      const data = (await res.json()) as AppPassword[] | { passwords?: AppPassword[] };
      const list: AppPassword[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.passwords)
          ? data.passwords
          : [];
      setState({ kind: 'loaded', passwords: list });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
      addToast({ type: 'error', title: t('passwords.load_failed'), message });
    }
  }, [baseUrl, addToast, t]);

  // Load once on mount (URL is guaranteed non-empty by the parent gate).
  useEffect(() => {
    void listPasswords();
  }, [listPasswords]);

  const handleMint = useCallback(async () => {
    setMint({ kind: 'minting' });
    try {
      const res = await apiFetch(buildRequestUrl(baseUrl, '/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label: mintLabel.trim() || undefined }),
      });
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      const data = (await res.json()) as { password?: string; id?: string };
      if (!data || typeof data.password !== 'string' || data.password.length === 0) {
        throw new Error('missing_password');
      }
      setMint({
        kind: 'minted',
        password: data.password,
        label: mintLabel.trim(),
      });
      setMintLabel('');
      addToast({ type: 'success', title: t('passwords.minted') });
      // Refresh the list so the new password appears alongside existing ones.
      void listPasswords();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMint({ kind: 'idle' });
      addToast({ type: 'error', title: t('passwords.mint_failed'), message });
    }
  }, [baseUrl, mintLabel, addToast, t, listPasswords]);

  const handleRevoke = useCallback(
    async (id: string) => {
      setRevokingId(id);
      try {
        const res = await apiFetch(buildRequestUrl(baseUrl, `/${encodeURIComponent(id)}`), {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`${res.status}`);
        }
        addToast({ type: 'success', title: t('passwords.revoked') });
        void listPasswords();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addToast({ type: 'error', title: t('passwords.revoke_failed'), message });
      } finally {
        setRevokingId(null);
      }
    },
    [baseUrl, addToast, t, listPasswords],
  );

  const onRevokeClick = useCallback(
    async (id: string) => {
      const confirmed = await confirmRevoke({
        title: t('passwords.revoke_confirm_title'),
        message: t('passwords.revoke_confirm_message'),
        confirmText: t('passwords.revoke_confirm'),
        variant: 'destructive',
      });
      if (confirmed) {
        void handleRevoke(id);
      }
    },
    [confirmRevoke, handleRevoke, t],
  );

  const closeMintDialog = useCallback(() => {
    setMint({ kind: 'idle' });
  }, []);

  const copyMintedPassword = useCallback(async () => {
    if (mint.kind !== 'minted') return;
    const ok = await copyToClipboard(mint.password);
    if (ok) {
      addToast({ type: 'success', title: t('copied') });
    } else {
      addToast({ type: 'error', title: t('copy_failed') });
    }
  }, [mint, addToast, t]);

  return (
    <div data-search-label={t('passwords.title')} className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-muted-foreground" />
        <h4 className="text-sm font-medium text-foreground">{t('passwords.title')}</h4>
      </div>
      <p className="text-xs text-muted-foreground">{t('passwords.description')}</p>

      {/* Mint form */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={mintLabel}
          onChange={(e) => setMintLabel(e.target.value)}
          placeholder={t('passwords.label_placeholder')}
          aria-label={t('passwords.label_placeholder')}
          maxLength={64}
          className="flex-1 h-9 px-3 rounded-md bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button
          size="sm"
          onClick={() => void handleMint()}
          disabled={mint.kind === 'minting'}
        >
          {mint.kind === 'minting' ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-1.5" />
          )}
          {t('passwords.mint')}
        </Button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{t('passwords.loading')}</span>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{t('passwords.load_failed')}</span>
          </div>
        )}
        {state.kind === 'loaded' && state.passwords.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('passwords.empty')}</p>
        )}
        {state.kind === 'loaded' &&
          state.passwords.map((pw) => (
            <div
              key={pw.id}
              className="flex items-center justify-between gap-2 p-2 rounded-md border border-border bg-muted/30"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">
                  {pw.label?.trim() || t('passwords.unnamed')}
                </p>
                {(pw.createdAt || pw.id) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {pw.createdAt ? `${pw.createdAt} · ` : ''}
                    <code className="font-mono">{pw.id}</code>
                  </p>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void onRevokeClick(pw.id)}
                disabled={revokingId === pw.id}
                aria-label={t('passwords.revoke_aria')}
              >
                {revokingId === pw.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span className="sr-only">{t('passwords.revoke')}</span>
              </Button>
            </div>
          ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void listPasswords()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          {t('passwords.refresh')}
        </Button>
      </div>

      {/* Minted-password copy-once dialog */}
      <MintedPasswordDialog
        isOpen={mint.kind === 'minted'}
        onClose={closeMintDialog}
        password={mint.kind === 'minted' ? mint.password : ''}
        onCopy={() => void copyMintedPassword()}
        title={t('passwords.minted_dialog_title')}
        warning={t('passwords.minted_dialog_warning')}
        copyWarning={t('passwords.minted_dialog_copy_warning')}
        doneLabel={t('passwords.minted_dialog_done')}
        valueLabel={t('passwords.minted_value_label')}
        copyLabel={t('copy')}
      />

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

/**
 * Copy-once dialog for a freshly minted app password. Built locally rather
 * than reusing ConfirmDialog because ConfirmDialog has no `children` slot,
 * and the minted password must be shown with its own copy button + a "this is
 * the only time you'll see it" warning.
 */
function MintedPasswordDialog({
  isOpen,
  onClose,
  password,
  onCopy,
  title,
  warning,
  copyWarning,
  doneLabel,
  valueLabel,
  copyLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  password: string;
  onCopy: () => void;
  title: string;
  warning: string;
  copyWarning: string;
  doneLabel: string;
  valueLabel: string;
  copyLabel: string;
}) {
  const dialogRef = useFocusTrap({ isActive: isOpen, onEscape: onClose, restoreFocus: true });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-[60] p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md"
      >
        <div className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{warning}</p>
          <div className="flex rounded-lg">
            <input
              type="text"
              readOnly
              value={password}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={valueLabel}
              className="py-2 px-3 block w-full bg-background border border-border border-e-transparent rounded-s-lg text-sm font-mono text-foreground focus:z-10 focus:border-ring focus:ring-ring"
            />
            <button
              type="button"
              onClick={onCopy}
              className="h-[38px] px-3 shrink-0 inline-flex items-center gap-1.5 rounded-e-lg border border-border bg-muted text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Copy className="size-3.5" />
              {copyLabel}
            </button>
          </div>
          <p className="text-xs text-destructive">{copyWarning}</p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <Button variant="default" onClick={onClose}>
            {doneLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ByomcSettings() {
  const t = useTranslations('settings.byomc');
  const { byomcImapHost, byomcSmtpHost, byomcAppPasswordApiUrl } = useConfig();

  const { primaryIdentity, username } = useAuthStore();
  const email = primaryIdentity?.email || username || '';

  const trimmedApiUrl = normalizeApiUrl(byomcAppPasswordApiUrl);

  return (
    <SettingsSection title={t('title')} description={t('description')}>
      <ConnectionCard imapHost={byomcImapHost} smtpHost={byomcSmtpHost} email={email} />
      <ClientHints />
      {trimmedApiUrl.length > 0 && <AppPasswordBlock apiUrl={trimmedApiUrl} />}
    </SettingsSection>
  );
}
