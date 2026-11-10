import { createElement } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarApp } from '@/components/calendar/calendar-app';
import { ContactsApp } from '@/components/contacts/contacts-app';
import { FilesApp } from '@/components/files/files-app';
import { useAuthStore } from '@/stores/auth-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

const mocks = vi.hoisted(() => ({ push: vi.fn(), loading: true }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  usePathname: () => '/en',
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en',
  useParams: () => ({ locale: 'en' }),
}));
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ isLoading: mocks.loading, calendarEnabled: false, contactsEnabled: false, filesEnabled: false }),
}));
vi.mock('@/hooks/use-is-embedded', () => ({ useIsEmbedded: () => true }));
vi.mock('@/hooks/use-sidebar-apps', () => ({ useSidebarApps: () => ({ loadedApps: [] }) }));
vi.mock('@/hooks/use-account-principal-emails', () => ({ useAccountPrincipalEmails: () => [] }));
vi.mock('@/hooks/use-pro-multi-account-calendars', () => ({
  useProMultiAccountCalendars: () => ({ enabled: false, accountClients: [] }),
}));
vi.mock('@/hooks/use-pro-multi-account-contacts', () => ({
  useProMultiAccountContacts: () => ({ enabled: false, accountClients: [] }),
}));

beforeEach(() => {
  mocks.push.mockClear();
  mocks.loading = true;
  useAuthStore.setState({ isAuthenticated: true, isLoading: false, client: {
    supportsCalendars: () => true,
    supportsContacts: () => true,
    supportsPrincipals: () => false,
    getCalendarsAccountId: () => 'synthetic',
    getAccountId: () => 'synthetic',
    getServerUrl: () => 'https://inbox.example.test',
    getMaxSizeUpload: () => 1000000,
    getUsername: () => 'member@example.test',
  } as unknown as IJMAPClient });
});

describe.each([
  ['Calendar', CalendarApp], ['Contacts', ContactsApp], ['Files', FilesApp],
] as const)('%s configuration loading', (_name, App) => {
  it('keeps the route while flags are loading, then redirects if disabled', () => {
    const view = render(createElement(App));
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.loading = false;
    view.rerender(createElement(App));
    expect(mocks.push).toHaveBeenCalledWith('/');
  });
});
