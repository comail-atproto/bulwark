import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/keyboard-shortcuts-modal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('@/components/search/search-box', () => ({ SearchBox: () => null }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-stalwart-admin', () => ({ useStalwartAdmin: () => false }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/mail',
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { NavigationRail } = await import('../navigation-rail');
const { useUpdateStore } = await import('@/stores/update-store');
const { useSettingsStore } = await import('@/stores/settings-store');
const { ACCESSIBILITY_PANEL_EVENT } = await import('@/components/accessibility/accessibility-quick-panel');

beforeEach(() => {
  useUpdateStore.setState({ startPolling: vi.fn() } as never);
  useSettingsStore.getState().resetToDefaults();
});

describe('accessibility button in the rail', () => {
  it('is hidden until the user switches it on', () => {
    render(<NavigationRail orientation="vertical" collapsed />);
    expect(screen.queryByTestId('rail-accessibility')).toBeNull();
  });

  it('opens the quick panel when switched on', () => {
    useSettingsStore.getState().updateSetting('showAccessibilityButton', true);
    const opened = vi.fn();
    window.addEventListener(ACCESSIBILITY_PANEL_EVENT, opened);
    render(<NavigationRail orientation="vertical" collapsed />);
    const button = screen.getByRole('button', { name: 'accessibility' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+A');
    fireEvent.click(button);
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(ACCESSIBILITY_PANEL_EVENT, opened);
  });
});
