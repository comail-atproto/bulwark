import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MvTopBar } from '../mv-top-bar';

const membership = vi.hoisted(() => ({ enrolled: false }));
vi.mock('@/hooks/use-builders-membership', () => ({ useBuildersMembership: () => membership.enrolled }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Comail' }) }));
vi.mock('@/hooks/use-resolved-sidebar-apps', () => ({ useResolvedSidebarApps: () => [] }));
vi.mock('@/hooks/use-stalwart-admin', () => ({ useStalwartAdmin: () => false }));
vi.mock('@/stores/policy-store', () => ({
  usePolicyStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ isFeatureEnabled: () => false, policy: { restrictions: {} } }),
    { subscribe: vi.fn(() => () => {}) },
  ),
}));
vi.mock('@/stores/update-store', () => ({
  selectHasUpdate: () => false,
  useUpdateStore: (selector: (state: unknown) => unknown) => selector({ startPolling: () => {} }),
}));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: (props: ComponentProps<'a'>) => <a {...props} />,
}));

describe('Builders in Mountain View Apps', () => {
  beforeEach(() => { membership.enrolled = false; });

  it('offers the enrolled account its Builders console even with custom apps disabled', () => {
    membership.enrolled = true;
    render(<MvTopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'add_app' }));

    const link = screen.getByRole('menuitem', { name: 'builders_label' });
    expect(link).toHaveAttribute('href', 'https://build.comail.at');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('builders');
    fireEvent.click(link);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'add_app' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides Builders when the active account is not enrolled', () => {
    render(<MvTopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'add_app' }));
    expect(screen.queryByRole('menuitem', { name: 'builders_label' })).not.toBeInTheDocument();
  });

  it('removes Builders from an open menu when switching to an unenrolled account', () => {
    membership.enrolled = true;
    const { rerender } = render(<MvTopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'add_app' }));
    expect(screen.getByRole('menuitem', { name: 'builders_label' })).toBeInTheDocument();
    membership.enrolled = false;
    rerender(<MvTopBar />);
    expect(screen.queryByRole('menuitem', { name: 'builders_label' })).not.toBeInTheDocument();
  });

  it('includes Builders in keyboard navigation and dismisses Apps with Escape', () => {
    membership.enrolled = true;
    render(<MvTopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'add_app' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'builders_label' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
