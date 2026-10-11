import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutDataSettings } from '../about-data-settings';

const config = vi.hoisted(() => ({
  sourceCodeUrl: '', appName: 'Comail', appLogoLightUrl: '/branding/comail/cammie-mark.png',
  appLogoDarkUrl: '/branding/comail/cammie-mark.png', settingsSyncEnabled: false,
}));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => config }));
vi.mock('@/stores/settings-store', () => ({ useSettingsStore: () => ({
  settingsSyncDisabled: false, updateSetting: vi.fn(), resetToDefaults: vi.fn(),
  exportSettings: vi.fn(), importSettings: vi.fn(),
}) }));
vi.mock('@/stores/policy-store', () => ({ usePolicyStore: () => ({ isFeatureEnabled: () => false }) }));
vi.mock('@/stores/update-store', () => ({
  useUpdateStore: (select: (state: object) => unknown) => select({ status: null, startPolling: vi.fn() }),
}));
vi.mock('@/lib/clear-cached-data', () => ({ clearCachedData: vi.fn() }));
vi.mock('../spam-siege-game', () => ({ SpamSiegeGame: () => null }));

beforeEach(() => { config.sourceCodeUrl = ''; });

it('points the source-code link at the modified Comail build by default', () => {
  render(<AboutDataSettings />);
  expect(screen.getByRole('link', { name: 'about.source_code' })).toHaveAttribute(
    'href', 'https://github.com/comail-atproto/bulwark',
  );
});

it('uses the operator-configured source-code URL', () => {
  config.sourceCodeUrl = 'https://git.example.com/operator/webmail';
  render(<AboutDataSettings />);
  expect(screen.getByRole('link', { name: 'about.source_code' })).toHaveAttribute('href', config.sourceCodeUrl);
});

it('uses the same configured URL for the corresponding-source offer', () => {
  config.sourceCodeUrl = 'https://source.example.com/releases/tested-revision.tar.gz';
  render(<AboutDataSettings />);
  expect(screen.getByRole('link', { name: /source\.example\.com/ })).toHaveAttribute('href', config.sourceCodeUrl);
});
