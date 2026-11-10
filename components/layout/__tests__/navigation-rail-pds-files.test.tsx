import { createElement, type ComponentProps } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NavigationRail } from '../navigation-rail';
import { JMAPClient } from '@/lib/jmap/client';
import { jmapSession } from '@/lib/__tests__/fixtures/jmap-session';
import { useAccountStore } from '@/stores/account-store';
import { useAuthStore } from '@/stores/auth-store';

vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ filesEnabled: true }) }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/mail',
  useRouter: () => ({ push: vi.fn() }),
  Link: (props: ComponentProps<'a'>) => createElement('a', props),
}));
vi.mock('@/stores/update-store', () => ({
  selectHasUpdate: () => false,
  useUpdateStore: (select: (value: unknown) => unknown) => select({ status: null, startPolling: () => {} }),
}));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/components/keyboard-shortcuts-modal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-builders-membership', () => ({ useBuildersMembership: () => false }));

afterEach(() => {
  useAuthStore.setState({ client: null, isAuthenticated: false });
  useAccountStore.setState({ accounts: [], activeAccountId: null });
  vi.restoreAllMocks();
});

it('shows the PDS Files link without opening Files and hides it when its account binding changes', async () => {
  const serverUrl = 'https://mail.example.test';
  const username = 'member@example.test';
  const id = useAccountStore.getState().addAccount({ serverUrl, username, label: 'Member', displayName: 'Member', email: username, authMode: 'basic', rememberMe: true, lastLoginAt: 1, isConnected: true, hasError: false, isDefault: true });
  const slot = useAccountStore.getState().getAccountById(id)!.cookieSlot;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  fetcher.mockResolvedValueOnce(Response.json(jmapSession({ accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } })));
  const client = new JMAPClient(serverUrl, username, 'synthetic');
  await client.connect();
  useAuthStore.setState({ client });
  const view = render(<NavigationRail collapsed={false} />);
  expect(screen.queryByRole('link', { name: 'files' })).not.toBeInTheDocument();
  if (process.env.COMAIL_FILES_NAV_EVIDENCE) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${process.env.COMAIL_FILES_NAV_EVIDENCE}.before.html`, view.container.innerHTML);
  }
  client.configurePrivateGroupware(slot, { calendar: false, contacts: false, files: true });
  view.rerender(<NavigationRail collapsed={false} />);
  expect(screen.getByRole('link', { name: 'files' })).toHaveAttribute('href', '/files');
  if (process.env.COMAIL_FILES_NAV_EVIDENCE) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${process.env.COMAIL_FILES_NAV_EVIDENCE}.after.html`, view.container.innerHTML);
  }
  act(() => useAccountStore.getState().updateAccount(id, { cookieSlot: slot + 1 }));
  view.rerender(<NavigationRail collapsed={false} />);
  expect(screen.queryByRole('link', { name: 'files' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/files/'))).toBe(false);
});
