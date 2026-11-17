import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// SR-09: the open folder is aria-current, expanders say which folder they
// open, and the unread count is part of the folder's name, also with the
// sidebar collapsed. CO-13: counts as a dot or hidden.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (key === 'name_unread' && params) return `${params.name}, ${params.count} unread`;
    if ((key === 'expand_folder' || key === 'collapse_folder') && params) return `${key} ${params.name}`;
    return key;
  },
  useLocale: () => 'en',
}));

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ startTour: vi.fn(), resetTourCompletion: vi.fn(), activeTour: null, endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/contexts/drag-drop-context', () => ({
  useDragDropContext: () => ({ isDragging: false }),
}));
vi.mock('@/hooks/use-mailbox-drop', () => ({
  useMailboxDrop: () => ({ dropHandlers: {}, isValidDropTarget: false, isInvalidDropTarget: false }),
}));
vi.mock('@/hooks/use-tag-drop', () => ({
  useTagDrop: () => ({ dropHandlers: {}, isValidDropTarget: false }),
}));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));

const { Sidebar } = await import('../sidebar');
const { useAuthStore } = await import('@/stores/auth-store');
const { useSettingsStore } = await import('@/stores/settings-store');
const { useUIStore } = await import('@/stores/ui-store');

const box = (id: string, name: string, role: string | null, extra: Partial<Mailbox> = {}) => ({
  id, name, role, parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true }, ...extra,
}) as unknown as Mailbox;

const mailboxes: Mailbox[] = [
  box('inbox', 'Inbox', 'inbox', { totalEmails: 120, unreadEmails: 4 }),
  box('drafts', 'Drafts', 'drafts', { totalEmails: 7 }),
  box('news', 'News', null, { totalEmails: 30, unreadEmails: 2 }),
  box('lists', 'Lists', null),
  { ...box('rust', 'Rust', null, { unreadEmails: 1 }), parentId: 'lists' } as Mailbox,
];

const folder = (name: RegExp | string) => screen.getByRole('button', { name });

describe('Sidebar folder names', () => {
  beforeEach(() => {
    useAuthStore.setState({ activeAccountId: 'login-a', client: { getAccountId: () => 'me', getCapabilities: () => ({}) } } as never);
    useSettingsStore.setState({
      hideAccountSwitcher: true,
      interfaceLayout: 'default',
      showFolderTotalCount: false,
      folderCountModes: {},
      unreadCountStyle: 'count',
    } as never);
  });

  it('marks the open folder as current, and only that one', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(folder('mailboxes.inbox, 4 unread')).toHaveAttribute('aria-current', 'page');
    expect(folder('News, 2 unread')).not.toHaveAttribute('aria-current');
  });

  it('puts the folder list in a labelled navigation landmark', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(screen.getByRole('navigation', { name: 'folders' })).toContainElement(folder('mailboxes.inbox, 4 unread'));
  });

  it('names a folder without unread mail by its name alone', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(folder('mailboxes.drafts')).toBeInTheDocument();
  });

  it('names each expander after its folder', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    const toggle = screen.getByRole('button', { name: /^(expand|collapse)_folder Lists$/ });
    expect(toggle).toHaveAttribute('aria-expanded');
  });

  it('keeps the unread count in the name with the sidebar collapsed', () => {
    useUIStore.setState({ sidebarCollapsed: true } as never);
    try {
      render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(folder('mailboxes.inbox, 4 unread')).toBeInTheDocument();
      expect(screen.queryAllByTestId('folder-counts')).toHaveLength(0);
    } finally {
      useUIStore.setState({ sidebarCollapsed: false } as never);
    }
  });

  it('shows a dot instead of the number and still says the count', () => {
    useSettingsStore.setState({ unreadCountStyle: 'dot' } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    const row = folder('mailboxes.inbox, 4 unread').closest('[data-testid="folder-row"]')!;
    expect(row.querySelector('[data-testid="folder-unread-dot"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="folder-counts"]')!.textContent).not.toContain('4');
  });

  it('hides unread counts and drops them from the name', () => {
    useSettingsStore.setState({ unreadCountStyle: 'hidden' } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(folder('mailboxes.inbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'mailboxes.inbox, 4 unread' })).toBeNull();
    const row = folder('mailboxes.inbox').closest('[data-testid="folder-row"]')!;
    expect(row.querySelector('[data-testid="folder-counts"]')).toBeNull();
  });
});
