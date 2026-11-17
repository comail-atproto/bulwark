import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// OP-01: the accessibility and help links the operator configures show in
// the same order wherever they appear (WCAG 3.2.6), and not at all when
// none is set.

const links = vi.hoisted(() => ({
  accessibilityStatementUrl: '',
  accessibilityFeedbackUrl: '',
  helpUrl: '',
  easyReadUrl: '',
  signLanguageUrl: '',
}));
vi.mock('@/hooks/use-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-config')>();
  return { ...actual, useConfig: () => ({ ...links }) };
});

import { HelpLinks } from '../help-links';
import { helpLinksFrom } from '@/lib/help-links';
const { AccountSwitcher } = await import('../account-switcher');
const { useAccountStore } = await import('@/stores/account-store');
const { useAuthStore } = await import('@/stores/auth-store');
const { useSettingsStore } = await import('@/stores/settings-store');

const account = {
  id: 'a', label: 'a@example.com', email: 'a@example.com', username: 'a@example.com', displayName: 'A',
  serverUrl: 'https://mail.example.com', avatarColor: '#336699', cookieSlot: 0, isConnected: true, isDefault: true,
};

beforeEach(() => {
  Object.assign(links, {
    accessibilityStatementUrl: 'https://example.com/accessibility',
    accessibilityFeedbackUrl: 'mailto:barriers@example.com',
    helpUrl: '',
    easyReadUrl: 'https://example.com/leichte-sprache',
    signLanguageUrl: '',
  });
  useAccountStore.setState({ accounts: [account] } as never);
  useAuthStore.setState({ activeAccountId: 'a' } as never);
  useSettingsStore.setState({ interfaceLayout: 'default' } as never);
});

describe('helpLinksFrom', () => {
  it('keeps the fixed order, leaves out unset links and refuses script URLs', () => {
    expect(helpLinksFrom({
      signLanguageUrl: 'https://example.com/dgs',
      helpUrl: 'javascript:alert(1)',
      accessibilityStatementUrl: 'https://example.com/a11y',
      accessibilityFeedbackUrl: 'mailto:barriers@example.com',
      easyReadUrl: '',
    })).toEqual([
      { id: 'statement', href: 'https://example.com/a11y', external: true },
      { id: 'feedback', href: 'mailto:barriers@example.com', external: false },
      { id: 'sign_language', href: 'https://example.com/dgs', external: true },
    ]);
  });
});

describe('help links on a page', () => {
  it('lists the configured links in a named navigation', () => {
    render(<HelpLinks />);
    const nav = screen.getByRole('navigation', { name: 'label' });
    const items = within(nav).getAllByRole('link');
    expect(items.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/accessibility',
      'mailto:barriers@example.com',
      'https://example.com/leichte-sprache',
    ]);
    // A web page opens in a new tab and says so; the mail link doesn't.
    expect(items[0].getAttribute('target')).toBe('_blank');
    expect(items[0].textContent).toBe('statement (new_tab)');
    expect(items[1].getAttribute('target')).toBeNull();
    expect(items[1].textContent).toBe('feedback');
  });

  it('renders nothing when the operator set no link', () => {
    Object.assign(links, { accessibilityStatementUrl: '', accessibilityFeedbackUrl: '', easyReadUrl: '' });
    const { container } = render(<HelpLinks />);
    expect(container.innerHTML).toBe('');
  });
});

describe('help links in the account menu', () => {
  it('offers them as menu items and closes the menu on choosing one', () => {
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    const group = screen.getByRole('group', { name: 'label' });
    const items = within(group).getAllByRole('menuitem');
    expect(items.map((a) => a.textContent)).toEqual(['statement (new_tab)', 'feedback', 'easy_read (new_tab)']);
    fireEvent.click(items[0]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers them under Mountain View too', () => {
    useSettingsStore.setState({ interfaceLayout: 'mountain-view' } as never);
    render(<AccountSwitcher variant="header" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    expect(within(screen.getByRole('group', { name: 'label' })).getAllByRole('menuitem')).toHaveLength(3);
  });

  it('leaves the group out when no link is set', () => {
    Object.assign(links, { accessibilityStatementUrl: '', accessibilityFeedbackUrl: '', easyReadUrl: '' });
    render(<AccountSwitcher variant="rail" />);
    fireEvent.click(screen.getByTestId('account-switcher'));
    expect(screen.queryByRole('group', { name: 'label' })).toBeNull();
  });
});
