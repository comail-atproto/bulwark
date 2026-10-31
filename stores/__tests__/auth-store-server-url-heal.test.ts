import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchConfig = vi.fn();
vi.mock('@/hooks/use-config', () => ({
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
}));

import { resolveAuthoritativeServerUrl } from '../auth-store';

function makeConfig(overrides: { allowCustomJmapEndpoint?: boolean; jmapServerUrl?: string } = {}) {
  return {
    appName: 'Webmail',
    jmapServerUrl: '',
    oauthEnabled: false,
    oauthOnly: false,
    oauthClientId: '',
    oauthIssuerUrl: '',
    oauthScopes: '',
    rememberMeEnabled: false,
    settingsSyncEnabled: false,
    stalwartFeaturesEnabled: true,
    identityManagementEnabled: true,
    devMode: false,
    faviconUrl: '',
    appLogoLightUrl: '',
    appLogoDarkUrl: '',
    loginLogoLightUrl: '',
    loginLogoDarkUrl: '',
    loginCompanyName: '',
    loginImprintUrl: '',
    loginPrivacyPolicyUrl: '',
    loginWebsiteUrl: '',
    loginLogoMaxHeight: '',
    loginLogoMaxWidth: '',
    loginShowHeading: true,
    loginShowSubtitle: true,
    demoMode: false,
    calendarEnabled: false,
    contactsEnabled: false,
    filesEnabled: false,
    appsEnabled: false,
    passwordSecurityEnabled: true,
    smimeEnabled: true,
    autoSsoEnabled: false,
    atprotoLoginUrl: '',
    allowCustomJmapEndpoint: false,
    jmapServers: [],
    jmapServerAutoPickByDomain: false,
    embeddedMode: false,
    parentOrigin: '',
    byomcEnabled: false,
    byomcImapHost: '',
    byomcSmtpHost: '',
    byomcAppPasswordApiUrl: '',
    ...overrides,
  };
}

describe('resolveAuthoritativeServerUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns config jmapServerUrl when config is authoritative and differs from stored', async () => {
    mockFetchConfig.mockResolvedValue(
      makeConfig({ allowCustomJmapEndpoint: false, jmapServerUrl: 'https://inbox.comail.at' }),
    );

    const result = await resolveAuthoritativeServerUrl('https://old.internal.example.test:8080');
    expect(result).toBe('https://inbox.comail.at');
  });

  it('returns stored value when only difference is trailing slash', async () => {
    mockFetchConfig.mockResolvedValue(
      makeConfig({ allowCustomJmapEndpoint: false, jmapServerUrl: 'https://inbox.comail.at/' }),
    );

    const result = await resolveAuthoritativeServerUrl('https://inbox.comail.at');
    expect(result).toBe('https://inbox.comail.at');
  });

  it('returns stored value when allowCustomJmapEndpoint is true', async () => {
    mockFetchConfig.mockResolvedValue(
      makeConfig({ allowCustomJmapEndpoint: true, jmapServerUrl: 'https://inbox.comail.at' }),
    );

    const result = await resolveAuthoritativeServerUrl('https://custom.example.com');
    expect(result).toBe('https://custom.example.com');
  });

  it('returns stored value when jmapServerUrl is empty', async () => {
    mockFetchConfig.mockResolvedValue(
      makeConfig({ allowCustomJmapEndpoint: false, jmapServerUrl: '' }),
    );

    const result = await resolveAuthoritativeServerUrl('https://old.internal.example.test:8080');
    expect(result).toBe('https://old.internal.example.test:8080');
  });

  it('returns stored value when fetchConfig throws', async () => {
    mockFetchConfig.mockRejectedValue(new Error('network error'));

    const result = await resolveAuthoritativeServerUrl('https://old.internal.example.test:8080');
    expect(result).toBe('https://old.internal.example.test:8080');
  });

  it('returns config value verbatim (with trailing slash) when URLs differ', async () => {
    mockFetchConfig.mockResolvedValue(
      makeConfig({ allowCustomJmapEndpoint: false, jmapServerUrl: 'https://inbox.comail.at/' }),
    );

    const result = await resolveAuthoritativeServerUrl('https://old.internal.example.test:8080');
    expect(result).toBe('https://inbox.comail.at/');
  });
});
