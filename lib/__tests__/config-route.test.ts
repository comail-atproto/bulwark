import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isConfigData } from '@/lib/config-validation';

// The route consults admin-dashboard overrides (ADMIN_CONFIG_DIR, default
// data/admin) before env vars. Point it at an empty temp dir so local admin
// state on the developer's machine can't leak into these env-driven
// assertions. Set directly (not via vi.stubEnv) so unstubAllEnvs() between
// tests can't clear it - the config-manager singleton caches it on first load.
process.env.ADMIN_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), 'bw-config-route-'));

// Mock NextResponse before importing the route
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { headers?: HeadersInit }) => ({
      json: async () => data,
      headers: new Headers(init?.headers),
    }),
  },
}));

const currentGroupwareEnabled = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/groupware/access', () => ({ currentGroupwareEnabled: (...args: unknown[]) => currentGroupwareEnabled(...args) }));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn() },
}));

// Env vars these tests drive. Stubbed to undefined before each test so the
// developer's / CI's real environment (and any other test file sharing this
// worker's process.env) can't leak in.
const MANAGED_ENV = [
  'APP_NAME', 'NEXT_PUBLIC_APP_NAME', 'JMAP_SERVER_URL', 'NEXT_PUBLIC_JMAP_SERVER_URL',
  'OAUTH_ENABLED', 'OAUTH_CLIENT_ID', 'OAUTH_ISSUER_URL', 'SESSION_SECRET',
  'SESSION_SECRET_FILE', 'SETTINGS_SYNC_ENABLED', 'STALWART_FEATURES', 'DEV_MOCK_JMAP',
  'FAVICON_URL', 'APP_LOGO_LIGHT_URL', 'APP_LOGO_DARK_URL', 'LOGIN_COMPANY_NAME',
  'LOGIN_IMPRINT_URL', 'LOGIN_PRIVACY_POLICY_URL', 'LOGIN_WEBSITE_URL', 'ATPROTO_LOGIN_URL',
  'DOMAIN_BRANDING', 'CALENDAR_ENABLED', 'CONTACTS_ENABLED', 'FILES_ENABLED',
  'APPS_ENABLED', 'DEMO_MODE', 'BYOMC_ENABLED', 'IMAP_HOST', 'SMTP_HOST',
  'APP_PASSWORD_API_URL', 'PASSWORD_SECURITY_ENABLED', 'SMIME_ENABLED',
  'IDENTITY_MANAGEMENT_ENABLED',
  'LOGIN_IMPRINT_URL', 'LOGIN_PRIVACY_POLICY_URL', 'LOGIN_WEBSITE_URL', 'DOMAIN_BRANDING',
  'JMAP_SERVERS', 'JMAP_SERVER_AUTO_PICK_BY_DOMAIN', 'SOURCE_CODE_URL',
] as const;

describe('config API route', () => {
  // Unique per-test dirs so the SESSION_SECRET_FILE tests never share a path;
  // removed synchronously in afterEach (the old fire-and-forget async unlink of
  // a shared ./session-secret raced across tests under the full suite).
  const tempDirs: string[] = [];
  function secretFile(contents = 'test-secret'): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'bw-secret-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'session-secret');
    writeFileSync(file, contents);
    return file;
  }

  beforeEach(() => {
    for (const key of MANAGED_ENV) vi.stubEnv(key, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function mockRequest(headers: Record<string, string> = {}): unknown {
    const lc: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lc[k.toLowerCase()] = v;
    return {
      headers: {
        get(name: string) {
          return lc[name.toLowerCase()] ?? null;
        },
      },
      cookies: {
        get(name: string) {
          return name === 'groupware_enabled' ? { value: '1' } : undefined;
        },
      },
    };
  }

  async function getConfig(headers?: Record<string, string>, authenticated = false) {
    // Re-import to pick up env changes
    const { GET } = await import('@/app/api/config/route');
    const request = mockRequest(headers) as Parameters<typeof GET>[0];
    if (authenticated) {
      vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
      const { encryptSession } = await import('@/lib/auth/crypto');
      request.cookies.get = ((name: string) => name === 'jmap_session' ? { value: encryptSession('https://inbox.example', 'owner@example.test', 'synthetic', { groupwareEnabled: true }) } : undefined) as typeof request.cookies.get;
    }
    const response = await GET(request);
    const config = await response.json();
    expect(isConfigData(config)).toBe(true);
    return config;
  }

  it('reads feature gates from the selected encrypted account session', async () => {
    vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
    vi.stubEnv('CALENDAR_ENABLED', 'true');
    const { encryptSession } = await import('@/lib/auth/crypto');
    const { GET } = await import('@/app/api/config/route');
    const request = mockRequest({ 'X-JMAP-Cookie-Slot': '1' }) as Parameters<typeof GET>[0];
    request.cookies.get = ((name: string) => name === 'jmap_session_1'
      ? { value: encryptSession('https://inbox.example', 'bob@example.test', 'password', { groupwareEnabled: false, buildersEnabled: false }) }
      : { value: '1' }) as typeof request.cookies.get;
    const config = await (await GET(request)).json();
    expect(config.calendarEnabled).toBe(false);
    expect(config.buildersEnabled).toBe(false);
  });

  it('prevents caching host-specific runtime configuration', async () => {
    const { GET } = await import('@/app/api/config/route');
    const response = await GET(mockRequest() as Parameters<typeof GET>[0]);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vary')).toBe('Host, X-Forwarded-Host');
  });

  it('should return defaults when no env vars are set', async () => {
    const config = await getConfig();

    expect(config.appName).toBe('Webmail');
    expect(config.jmapServerUrl).toBe('');
    expect(config.oauthEnabled).toBe(false);
    expect(config.oauthClientId).toBe('');
    expect(config.oauthIssuerUrl).toBe('');
    expect(config.rememberMeEnabled).toBe(false);
    expect(config.settingsSyncEnabled).toBe(false);
    expect(config.stalwartFeaturesEnabled).toBe(true);
    expect(config.devMode).toBe(false);
    expect(config.loginCompanyName).toBe('');
    expect(config.loginImprintUrl).toBe('');
    expect(config.loginPrivacyPolicyUrl).toBe('');
    expect(config.loginWebsiteUrl).toBe('');
    expect(config.faviconUrl).toBe('/branding/comail/comail-favicon.png');
    expect(config.appLogoLightUrl).toBe('/branding/comail/cammie-mark.png');
    expect(config.appLogoDarkUrl).toBe('/branding/comail/cammie-mark.png');
    expect(config.loginLogoLightUrl).toBe('/branding/comail/cammie-mark.png');
    expect(config.loginLogoDarkUrl).toBe('/branding/comail/cammie-mark.png');
    expect(config.atprotoLoginUrl).toBe('');
    // Groupware surfaces are gated off by default until Stalwart groupware
    // enablement lands (chainlink #1421).
    expect(config.calendarEnabled).toBe(false);
    expect(config.contactsEnabled).toBe(false);
    expect(config.filesEnabled).toBe(false);
    expect(config.appsEnabled).toBe(false);
    // BYOMC defaults (atmosphere-mail #1791): section off, no hosts, no
    // app-password API — Comail today ships without a password-mint service.
    expect(config.byomcEnabled).toBe(false);
    expect(config.byomcImapHost).toBe('');
    expect(config.byomcSmtpHost).toBe('');
    expect(config.byomcAppPasswordApiUrl).toBe('');
    // Password-security + S/MIME surfaces default ON (vanilla deployments).
    // Comail atproto-SSO deployments turn them off via env.
    expect(config.passwordSecurityEnabled).toBe(true);
    expect(config.smimeEnabled).toBe(true);
    expect(config.identityManagementEnabled).toBe(true);
    expect(config.sourceCodeUrl).toBe('');
  });

  // The domain lists name every organisation served by this instance.
  it('lists the domains of each server only when the login page picks servers by domain', async () => {
    vi.stubEnv('JMAP_SERVERS', JSON.stringify([{ id: 'a', label: 'A', url: 'https://a.example', domains: ['acme.example'] }]));
    expect((await getConfig()).jmapServers[0].domains).toEqual([]);

    vi.stubEnv('JMAP_SERVER_AUTO_PICK_BY_DOMAIN', 'true');
    expect((await getConfig()).jmapServers[0].domains).toEqual(['acme.example']);
  });

  it('should use runtime env vars over defaults', async () => {
    vi.stubEnv('APP_NAME', 'My Mail');
    vi.stubEnv('JMAP_SERVER_URL', 'https://mail.example.com');

    const config = await getConfig();

    expect(config.appName).toBe('My Mail');
    expect(config.jmapServerUrl).toBe('https://mail.example.com');
  });

  it('should fall back to NEXT_PUBLIC_ vars when runtime vars are unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_NAME', 'Legacy Mail');
    vi.stubEnv('NEXT_PUBLIC_JMAP_SERVER_URL', 'https://legacy.example.com');

    const config = await getConfig();

    expect(config.appName).toBe('Legacy Mail');
    expect(config.jmapServerUrl).toBe('https://legacy.example.com');
  });

  it('should prefer runtime vars over NEXT_PUBLIC_ vars', async () => {
    vi.stubEnv('APP_NAME', 'Runtime');
    vi.stubEnv('NEXT_PUBLIC_APP_NAME', 'BuildTime');

    const config = await getConfig();

    expect(config.appName).toBe('Runtime');
  });

  it('should return login page customization values', async () => {
    vi.stubEnv('LOGIN_COMPANY_NAME', 'Acme Corp');
    vi.stubEnv('LOGIN_IMPRINT_URL', 'https://acme.com/imprint');
    vi.stubEnv('LOGIN_PRIVACY_POLICY_URL', 'https://acme.com/privacy');
    vi.stubEnv('LOGIN_WEBSITE_URL', 'https://acme.com');

    const config = await getConfig();

    expect(config.loginCompanyName).toBe('Acme Corp');
    expect(config.loginImprintUrl).toBe('https://acme.com/imprint');
    expect(config.loginPrivacyPolicyUrl).toBe('https://acme.com/privacy');
    expect(config.loginWebsiteUrl).toBe('https://acme.com');
  });

  it('should return atproto login URL when set', async () => {
    process.env.ATPROTO_LOGIN_URL = 'https://comail.at/webmail/login';

    const config = await getConfig();

    expect(config.atprotoLoginUrl).toBe('https://comail.at/webmail/login');
  });

  it('publishes the source code URL for the About card (#1161)', async () => {
    vi.stubEnv('SOURCE_CODE_URL', 'https://git.example.com/acme/webmail/tree/v1.2.3');

    expect((await getConfig()).sourceCodeUrl).toBe('https://git.example.com/acme/webmail/tree/v1.2.3');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relative/path', 'not a url'])(
    'drops a source code URL that is not absolute http(s): %s',
    async (value) => {
      vi.stubEnv('SOURCE_CODE_URL', value);

      expect((await getConfig()).sourceCodeUrl).toBe('');
    },
  );

  it('should handle partial login customization', async () => {
    vi.stubEnv('LOGIN_COMPANY_NAME', 'Partial Corp');
    // Leave URLs unset

    const config = await getConfig();

    expect(config.loginCompanyName).toBe('Partial Corp');
    expect(config.loginImprintUrl).toBe('');
    expect(config.loginPrivacyPolicyUrl).toBe('');
    expect(config.loginWebsiteUrl).toBe('');
  });

  it('should enable rememberMe when SESSION_SECRET is set', async () => {
    vi.stubEnv('SESSION_SECRET', 'test-secret');

    const config = await getConfig();

    expect(config.rememberMeEnabled).toBe(true);
  });

  it('should enable rememberMe when SESSION_SECRET_FILE is set', async () => {
    vi.stubEnv('SESSION_SECRET_FILE', secretFile());

    const config = await getConfig();

    expect(config.rememberMeEnabled).toBe(true);
  });

  it('should enable settingsSync only when both SESSION_SECRET and SETTINGS_SYNC_ENABLED are set', async () => {
    vi.stubEnv('SETTINGS_SYNC_ENABLED', 'true');
    const config1 = await getConfig();
    expect(config1.settingsSyncEnabled).toBe(false);

    vi.stubEnv('SESSION_SECRET', 'test-secret');
    const config2 = await getConfig();
    expect(config2.settingsSyncEnabled).toBe(true);
  });

  it('should enable settingsSync only when both SESSION_SECRET_FILE and SETTINGS_SYNC_ENABLED are set', async () => {
    vi.stubEnv('SETTINGS_SYNC_ENABLED', 'true');
    const config1 = await getConfig();
    expect(config1.settingsSyncEnabled).toBe(false);

    vi.stubEnv('SESSION_SECRET_FILE', secretFile());
    const config2 = await getConfig();
    expect(config2.settingsSyncEnabled).toBe(true);
  });

  it('should disable stalwart features when explicitly set to false', async () => {
    vi.stubEnv('STALWART_FEATURES', 'false');

    const config = await getConfig();

    expect(config.stalwartFeaturesEnabled).toBe(false);
  });

  it('should return custom favicon and app logo URLs', async () => {
    vi.stubEnv('FAVICON_URL', '/branding/custom-favicon.svg');
    vi.stubEnv('APP_LOGO_LIGHT_URL', '/branding/my-logo.svg');
    vi.stubEnv('APP_LOGO_DARK_URL', '/branding/my-logo-white.svg');

    const config = await getConfig();

    expect(config.faviconUrl).toBe('/branding/custom-favicon.svg');
    expect(config.appLogoLightUrl).toBe('/branding/my-logo.svg');
    expect(config.appLogoDarkUrl).toBe('/branding/my-logo-white.svg');
  });

  describe('per-domain branding overrides', () => {
    it('applies overrides for the matching host', async () => {
      vi.stubEnv('LOGIN_COMPANY_NAME', 'Default Co');
      vi.stubEnv('LOGIN_WEBSITE_URL', 'https://default.example');
      vi.stubEnv('DOMAIN_BRANDING', JSON.stringify([
        {
          host: 'mail1.example.com',
          loginCompanyName: 'Brand One',
          loginWebsiteUrl: 'https://one.example',
        },
      ]));

      const config = await getConfig({ host: 'mail1.example.com' });

      expect(config.loginCompanyName).toBe('Brand One');
      expect(config.loginWebsiteUrl).toBe('https://one.example');
    });

    it('falls through to the global value when the host has no entry', async () => {
      vi.stubEnv('LOGIN_COMPANY_NAME', 'Default Co');
      vi.stubEnv('DOMAIN_BRANDING', JSON.stringify([
        { host: 'mail1.example.com', loginCompanyName: 'Brand One' },
      ]));

      const config = await getConfig({ host: 'unmapped.example.com' });

      expect(config.loginCompanyName).toBe('Default Co');
    });

    it('falls through field-by-field when the matching entry omits a field', async () => {
      vi.stubEnv('LOGIN_COMPANY_NAME', 'Default Co');
      vi.stubEnv('LOGIN_WEBSITE_URL', 'https://default.example');
      vi.stubEnv('DOMAIN_BRANDING', JSON.stringify([
        { host: 'mail1.example.com', loginCompanyName: 'Brand One' },
      ]));

      const config = await getConfig({ host: 'mail1.example.com' });

      expect(config.loginCompanyName).toBe('Brand One');
      expect(config.loginWebsiteUrl).toBe('https://default.example');
    });

    it('prefers X-Forwarded-Host over Host', async () => {
      vi.stubEnv('DOMAIN_BRANDING', JSON.stringify([
        { host: 'public.example.com', loginCompanyName: 'Public' },
      ]));

      const config = await getConfig({
        host: 'internal.example.com',
        'x-forwarded-host': 'public.example.com',
      });

      expect(config.loginCompanyName).toBe('Public');
    });

    it('strips the port from the host header before matching', async () => {
      vi.stubEnv('DOMAIN_BRANDING', JSON.stringify([
        { host: 'mail1.example.com', loginCompanyName: 'Brand One' },
      ]));

      const config = await getConfig({ host: 'mail1.example.com:8443' });

      expect(config.loginCompanyName).toBe('Brand One');
    });
  });

  describe('groupware feature flags', () => {
    it('does not grant UI access from a feature cookie without an encrypted session', async () => {
      process.env.CALENDAR_ENABLED = 'true';
      const config = await getConfig();
      expect(config.calendarEnabled).toBe(false);
    });

    it('turns off all groupware surfaces when Inbox withdraws the live flag', async () => {
      for (const key of ['CALENDAR_ENABLED', 'CONTACTS_ENABLED', 'FILES_ENABLED', 'APPS_ENABLED']) vi.stubEnv(key, 'true');
      currentGroupwareEnabled.mockResolvedValueOnce(false);
      const config = await getConfig(undefined, true);
      expect(config.calendarEnabled).toBe(false);
      expect(config.contactsEnabled).toBe(false);
      expect(config.filesEnabled).toBe(false);
      expect(config.appsEnabled).toBe(false);
    });
    it('enables each groupware surface when its env flag is true', async () => {
      process.env.CALENDAR_ENABLED = 'true';
      process.env.CONTACTS_ENABLED = 'true';
      process.env.FILES_ENABLED = 'true';
      process.env.APPS_ENABLED = 'true';

      const config = await getConfig(undefined, true);

      expect(config.calendarEnabled).toBe(true);
      expect(config.contactsEnabled).toBe(true);
      expect(config.filesEnabled).toBe(true);
      expect(config.appsEnabled).toBe(true);
    });

    it('gates each groupware surface independently', async () => {
      process.env.CALENDAR_ENABLED = 'true';
      // CONTACTS/FILES/APPS left unset → default false

      const config = await getConfig(undefined, true);

      expect(config.calendarEnabled).toBe(true);
      expect(config.contactsEnabled).toBe(false);
      expect(config.filesEnabled).toBe(false);
      expect(config.appsEnabled).toBe(false);
    });

    it('forces all groupware surfaces on in demo mode regardless of the flags', async () => {
      // Demo mode must show the full groupware UI even though prod defaults
      // gate it off — demo fixtures back these surfaces. This makes demo
      // visibility explicit rather than relying on prod-default leakage.
      process.env.DEMO_MODE = 'true';
      process.env.CALENDAR_ENABLED = 'false';
      process.env.CONTACTS_ENABLED = 'false';
      process.env.FILES_ENABLED = 'false';
      process.env.APPS_ENABLED = 'false';

      const config = await getConfig();

      expect(config.demoMode).toBe(true);
      expect(config.calendarEnabled).toBe(true);
      expect(config.contactsEnabled).toBe(true);
      expect(config.filesEnabled).toBe(true);
      expect(config.appsEnabled).toBe(true);
    });
  });

  describe('BYOMC (connect a mail client) gates — atmosphere-mail #1791', () => {
    it('enables the section when BYOMC_ENABLED is true and surfaces configured hosts', async () => {
      process.env.BYOMC_ENABLED = 'true';
      process.env.IMAP_HOST = 'imap.example.com';
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.APP_PASSWORD_API_URL = 'https://ap.example.com';

      const config = await getConfig();

      expect(config.byomcEnabled).toBe(true);
      expect(config.byomcImapHost).toBe('imap.example.com');
      expect(config.byomcSmtpHost).toBe('smtp.example.com');
      expect(config.byomcAppPasswordApiUrl).toBe('https://ap.example.com');
    });

    it('gates the section off when BYOMC_ENABLED is unset (default false)', async () => {
      // Hosts may still be set for a future flip; the *section* gate is what
      // hides the tab. App-password URL empty → no dead mint buttons.
      process.env.IMAP_HOST = 'imap.example.com';

      const config = await getConfig();

      expect(config.byomcEnabled).toBe(false);
      expect(config.byomcImapHost).toBe('imap.example.com');
    });

    it('forces the section on in demo mode even when BYOMC_ENABLED is false', async () => {
      // Demo mode must show the connect-a-mail-client UI so the demo can
      // exercise it — same rationale as the groupware gates. Hosts/URL are
      // NOT faked: an empty value stays empty (config-missing notice / absent
      // app-password block), never fabricated.
      process.env.DEMO_MODE = 'true';
      process.env.BYOMC_ENABLED = 'false';

      const config = await getConfig();

      expect(config.demoMode).toBe(true);
      expect(config.byomcEnabled).toBe(true);
      expect(config.byomcImapHost).toBe('');
      expect(config.byomcSmtpHost).toBe('');
      expect(config.byomcAppPasswordApiUrl).toBe('');
    });
  });

  // Password-security + S/MIME surface gates. These surfaces
  // don't apply to Comail's atproto-SSO members, so Comail sets both envs to
  // `false`. Vanilla deployments leave them unset → default `true` so the
  // Security and Encryption tabs keep rendering unchanged.
  describe('password-security + smime feature flags', () => {
    it('defaults both surfaces on when neither env is set', async () => {
      const config = await getConfig();

      expect(config.passwordSecurityEnabled).toBe(true);
      expect(config.smimeEnabled).toBe(true);
    });

    it('disables the password-security surface when PASSWORD_SECURITY_ENABLED=false', async () => {
      process.env.PASSWORD_SECURITY_ENABLED = 'false';

      const config = await getConfig();

      expect(config.passwordSecurityEnabled).toBe(false);
      // S/MIME is independent.
      expect(config.smimeEnabled).toBe(true);
    });

    it('disables the S/MIME surface when SMIME_ENABLED=false', async () => {
      process.env.SMIME_ENABLED = 'false';

      const config = await getConfig();

      expect(config.smimeEnabled).toBe(false);
      expect(config.passwordSecurityEnabled).toBe(true);
    });

    it('disables both surfaces when both envs are false', async () => {
      process.env.PASSWORD_SECURITY_ENABLED = 'false';
      process.env.SMIME_ENABLED = 'false';

      const config = await getConfig();

      expect(config.passwordSecurityEnabled).toBe(false);
      expect(config.smimeEnabled).toBe(false);
    });
  });

  describe('identity management flag', () => {
    it('defaults identityManagementEnabled to true when unset', async () => {
      const config = await getConfig();
      expect(config.identityManagementEnabled).toBe(true);
    });

    it('disables identity management when IDENTITY_MANAGEMENT_ENABLED=false', async () => {
      process.env.IDENTITY_MANAGEMENT_ENABLED = 'false';
      const config = await getConfig();
      expect(config.identityManagementEnabled).toBe(false);
    });

    it('keeps identity management on when IDENTITY_MANAGEMENT_ENABLED=true', async () => {
      process.env.IDENTITY_MANAGEMENT_ENABLED = 'true';
      const config = await getConfig();
      expect(config.identityManagementEnabled).toBe(true);
    });
  });
});
