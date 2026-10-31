import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationRail } from '../navigation-rail';

const membership = vi.hoisted(() => ({ enrolled: false }));
vi.mock('@/hooks/use-builders-membership', () => ({ useBuildersMembership: () => membership.enrolled }));

vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({
    appLogoLightUrl: '/branding/comail/cammie-mark.png',
    appLogoDarkUrl: '/branding/comail/cammie-mark.png',
    calendarEnabled: false,
    contactsEnabled: false,
    filesEnabled: false,
    appsEnabled: false,
    buildersEnabled: false,
  }),
}));
vi.mock('@/stores/update-store', () => ({
  selectHasUpdate: () => false,
  useUpdateStore: (selector: (state: unknown) => unknown) => selector({
    status: null,
    startPolling: () => {},
    stopPolling: () => {},
  }),
}));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/components/keyboard-shortcuts-modal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));

describe('Builder product navigation', () => {
  beforeEach(() => { membership.enrolled = false; });

  it.each([false, true])('shows the desktop link for an enrolled account (collapsed=%s)', (collapsed) => {
    membership.enrolled = true;
    render(<NavigationRail collapsed={collapsed} />);

    const link = screen.getByRole('link', { name: 'Comail for Builders' });
    expect(link).toHaveAttribute('href', 'https://build.comail.at');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it.each([false, true])('hides the desktop link for an unenrolled account (collapsed=%s)', (collapsed) => {
    render(<NavigationRail collapsed={collapsed} />);
    expect(screen.queryByRole('link', { name: 'Comail for Builders' })).not.toBeInTheDocument();
  });

  it('keeps the compact mobile bar without the Builder link', () => {
    membership.enrolled = true;
    render(<NavigationRail orientation="horizontal" />);
    expect(screen.queryByRole('link', { name: 'Comail for Builders' })).not.toBeInTheDocument();
  });
});
