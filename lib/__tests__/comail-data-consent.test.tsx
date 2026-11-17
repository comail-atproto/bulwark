import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { useFileStore } from '@/stores/file-store';
import { useToastStore } from '@/stores/toast-store';
import { clearAllStores } from '@/lib/account-state-manager';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }), useParams: () => ({ locale: 'en' }),
  usePathname: () => '/en/contacts', useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-config', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/use-config')>(),
  useConfig: () => ({ contactsEnabled: true, filesEnabled: true, isLoading: false }),
}));
vi.mock('@/components/contacts/contact-activity', () => ({ ContactActivity: () => null }));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/layout/sidebar-apps-modal', () => ({ SidebarAppsModal: () => null }));
vi.mock('@/components/layout/inline-app-view', () => ({ InlineAppView: () => null }));
vi.mock('@/components/layout/mv-top-bar', () => ({ MvTopBar: () => null }));
vi.mock('@/components/plugins/app-top-banner-slot', () => ({ AppTopBannerSlot: () => null }));
vi.mock('@/hooks/use-sidebar-apps', () => ({ useSidebarApps: () => ({
  showAppsModal: false, inlineApp: null, loadedApps: [], handleManageApps: vi.fn(),
  handleInlineApp: vi.fn(), closeInlineApp: vi.fn(), closeAppsModal: vi.fn(),
}) }));

import { ContactsApp } from '@/components/contacts/contacts-app';
import { FilesApp } from '@/components/files/files-app';

afterEach(() => {
  act(() => { useAuthStore.setState({ isAuthenticated: false, client: null }); clearAllStores(); useToastStore.getState().clearToasts(); });
  vi.restoreAllMocks();
});

describe('private-data consent in the native screens', () => {
  it.each(['contacts', 'files'] as const)('offers the validated %s ticket as a user action', async resource => {
    const client = new JMAPClient('https://mail.example.test', 'alice@example.test', 'unused');
    vi.spyOn(client, 'supportsPrincipals').mockReturnValue(false);
    vi.spyOn(client, 'listAllFileNodes').mockResolvedValue([]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const url = `https://inbox.comail.at/oauth/${resource}/tickets/${'A'.repeat(43)}`;
    act(() => {
      useToastStore.getState().clearToasts();
      useAuthStore.setState({ isAuthenticated: true, client, isLoading: false });
      if (resource === 'contacts') {
        useContactStore.setState({ contacts: [], supportsSync: false, contactsLoaded: true, spaceContactsAuthorizationUrl: url });
      } else {
        useFileStore.setState({ client, resources: [], supportsFiles: true, hasListed: true, spaceFilesAuthorizationUrl: url });
      }
    });
    render(resource === 'contacts' ? <ContactsApp /> : <FilesApp />);
    await waitFor(() => expect(useToastStore.getState().toasts.some(toast => toast.action?.label === 'private_consent_action')).toBe(true));
    expect(open).not.toHaveBeenCalled();
    act(() => useToastStore.getState().toasts.find(toast => toast.action?.label === 'private_consent_action')!.action!.onClick());
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });
});
