import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutDataSettings, AboutFooter } from '../about-data-settings';

const config = vi.hoisted(() => ({
  sourceCodeUrl: '', appName: 'Comail', appLogoLightUrl: '/branding/comail/cammie-mark.png',
  appLogoDarkUrl: '/branding/comail/cammie-mark.png', settingsSyncEnabled: false,
}));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => config }));
vi.mock('@/stores/settings-store', () => ({ useSettingsStore: () => ({
  settingsSyncDisabled: false, updateSetting: vi.fn(), resetToDefaults: vi.fn(),
  exportSettings: vi.fn(), importSettings: vi.fn(),
}) }));
vi.mock('@/stores/policy-store', () => ({ usePolicyStore: () => ({ isFeatureEnabled: () => false, isSettingHidden: () => false, isSettingLocked: () => false }) }));
vi.mock('@/stores/update-store', () => ({
  useUpdateStore: (select: (state: object) => unknown) => select({ status: null, startPolling: vi.fn() }),
}));
vi.mock('@/lib/clear-cached-data', () => ({ clearCachedData: vi.fn() }));
vi.mock('../spam-siege-game', () => ({ SpamSiegeGame: () => null }));

beforeEach(() => {
  config.sourceCodeUrl = '';
  vi.stubEnv('NEXT_PUBLIC_CORRESPONDING_SOURCE_URL', 'https://tangled.org/comail.at/bulwark');
});
afterEach(() => { vi.unstubAllEnvs(); });

function renderAbout() {
  return render(<><AboutFooter /><AboutDataSettings /></>);
}

it('points the source-code link at the modified Comail build by default', () => {
  renderAbout();
  expect(screen.getByRole('link', { name: 'about.source_code' })).toHaveAttribute(
    'href', 'https://tangled.org/comail.at/bulwark',
  );
  expect(screen.getByRole('link', { name: /tangled\.org/ })).toHaveAttribute(
    'href', 'https://tangled.org/comail.at/bulwark',
  );
});

it('uses the build-configured source for both About links', () => {
  const sourceUrl = 'https://source.example.com/releases/build-revision.tar.gz';
  vi.stubEnv('NEXT_PUBLIC_CORRESPONDING_SOURCE_URL', sourceUrl);
  renderAbout();
  expect(screen.getByRole('link', { name: 'about.source_code' })).toHaveAttribute('href', sourceUrl);
  expect(screen.getByRole('link', { name: /source\.example\.com/ })).toHaveAttribute('href', sourceUrl);
});

it('uses the operator-configured source-code URL', () => {
  config.sourceCodeUrl = 'https://git.example.com/operator/webmail';
  renderAbout();
  expect(screen.getByRole('link', { name: 'about.source_code' })).toHaveAttribute('href', config.sourceCodeUrl);
});

it('uses the same configured URL for the corresponding-source offer', () => {
  config.sourceCodeUrl = 'https://source.example.com/releases/tested-revision.tar.gz';
  renderAbout();
  expect(screen.getByRole('link', { name: /source\.example\.com/ })).toHaveAttribute('href', config.sourceCodeUrl);
});
