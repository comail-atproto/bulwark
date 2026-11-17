import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { branding } = vi.hoisted(() => ({
  branding: {
    appName: 'Comail Inbox',
    appLogoLightUrl: '/branding/comail/cammie-mark.png',
    appLogoDarkUrl: '/branding/comail/cammie-mark.png',
  },
}));

vi.mock('@/hooks/use-config', () => ({ useConfig: () => branding }));
vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
}));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));

const { EmailViewer } = await import('../email-viewer');
const { useAuthStore } = await import('@/stores/auth-store');
const { useThemeStore } = await import('@/stores/theme-store');

beforeEach(() => {
  useAuthStore.setState({ isDemoMode: true });
  useThemeStore.setState({ resolvedTheme: 'light' });
  branding.appLogoLightUrl = '/branding/comail/cammie-mark.png';
  branding.appLogoDarkUrl = '/branding/comail/cammie-mark.png';
});

function renderWelcome() {
  render(<EmailViewer email={null} mailboxes={[]} />);
}

describe('demo welcome branding', () => {
  it('uses Comail branding instead of the upstream logo', () => {
    renderWelcome();
    expect(screen.getByRole('img', { name: 'Comail Inbox' })).toHaveAttribute('src', '/branding/comail/cammie-mark.png');
    expect(screen.queryByRole('img', { name: 'Bulwark Mail' })).toBeNull();
  });

  it.each(['light', 'dark'] as const)('honors the configured %s logo', (theme) => {
    branding.appLogoLightUrl = '/branding/custom-light.svg';
    branding.appLogoDarkUrl = '/branding/custom-dark.svg';
    useThemeStore.setState({ resolvedTheme: theme });
    renderWelcome();
    expect(screen.getByRole('img', { name: 'Comail Inbox' })).toHaveAttribute('src', `/branding/custom-${theme}.svg`);
  });
});
