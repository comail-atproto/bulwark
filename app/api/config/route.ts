import { currentGroupwareEnabled } from '@/lib/groupware/access';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { parseJmapServers, redactJmapServers } from '@/lib/admin/jmap-servers';
import { hasSessionSecret } from '@/lib/auth/session-secret';
import { getOauthScopes } from '@/lib/oauth/tokens';
import { httpUrlOrEmpty } from '@/lib/config-validation';
import {
  matchDomainBranding,
  parseDomainBranding,
  pickRequestHost,
  type BrandingOverrideKey,
} from '@/lib/admin/domain-branding';

/**
 * Runtime configuration endpoint
 *
 * This endpoint serves configuration values that can be set at runtime
 * via environment variables or admin dashboard overrides, enabling
 * post-build configuration for Docker deployments.
 *
 * Priority order:
 * 1. Per-domain branding override (admin-configured, matched on request host)
 * 2. Admin dashboard overrides (data/admin/config.json)
 * 3. Runtime env vars (APP_NAME, JMAP_SERVER_URL)
 * 4. Build-time env vars (NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_JMAP_SERVER_URL)
 * 5. Default values
 */
export async function GET(request: NextRequest) {
  logger.debug('Config requested');
  await configManager.ensureLoaded();

  const host = pickRequestHost(request);
  const domainOverrides = matchDomainBranding(
    host,
    parseDomainBranding(configManager.get<unknown>('domainBranding', [])),
  );

  // Per-domain override wins over the global value, but only when the
  // entry explicitly sets that key. Otherwise we fall through to the
  // global admin/env/default chain.
  const branded = <T,>(key: BrandingOverrideKey, fallback: T): T => {
    const override = domainOverrides[key];
    if (typeof override === 'string' && override.length > 0) return override as T;
    return configManager.get<T>(key, fallback);
  };

  const appName =
    branded<string>('appName', '') || process.env.NEXT_PUBLIC_APP_NAME || 'Webmail';
  const jmapServerUrl = configManager.get<string>('jmapServerUrl') || process.env.NEXT_PUBLIC_JMAP_SERVER_URL || '';
  const oauthEnabled = configManager.get<boolean>('oauthEnabled', false);
  const oauthOnly = oauthEnabled && configManager.get<boolean>('oauthOnly', false);
  const stalwartFeaturesEnabled = configManager.get<boolean>('stalwartFeaturesEnabled', true);
  // Identity management defaults on; Comail production sets
  // IDENTITY_MANAGEMENT_ENABLED=false so members cannot mint arbitrary
  // From-identities. The Identities UI reads this to lock the address field and
  // hide create/delete while keeping display-name + signature editing.
  const identityManagementEnabled = configManager.get<boolean>('identityManagementEnabled', true);
  const stalwartJmapPassthroughEnabled =
    stalwartFeaturesEnabled && configManager.get<boolean>('stalwartJmapPassthroughEnabled', true);
  const allowedFrameAncestors = configManager.get<string>('allowedFrameAncestors', '');
  const autoPickByDomain = configManager.get<boolean>('jmapServerAutoPickByDomain', false);

  // Groupware requires both operator configuration and the active account's
  // Inbox entitlement, authenticated by SSO and stored in its encrypted session.
  // Demo mode enables groupware against its fixtures.
  const demoMode = configManager.get<boolean>('demoMode', false);
  const requestedSlot = request.headers.get('X-JMAP-Cookie-Slot') ?? '0';
  const slot = /^(0|[1-9][0-9]*)$/.test(requestedSlot) && Number(requestedSlot) < MAX_ACCOUNT_SLOTS
    ? Number(requestedSlot) : 0;
  const sessionToken = request.cookies.get(sessionCookieName(slot))?.value;
  const session = sessionToken ? decryptSession(sessionToken) : null;
  const sessionGroupwareEnabled = session?.groupwareEnabled === true
    && await currentGroupwareEnabled(session.username);
  const envCalendarEnabled = configManager.get<boolean>('calendarEnabled', false);
  const envContactsEnabled = configManager.get<boolean>('contactsEnabled', false);
  const envFilesEnabled = configManager.get<boolean>('filesEnabled', false);
  const envAppsEnabled = configManager.get<boolean>('appsEnabled', false);
  const calendarEnabled = demoMode || (sessionGroupwareEnabled && envCalendarEnabled);
  const contactsEnabled = demoMode || (sessionGroupwareEnabled && envContactsEnabled);
  const filesEnabled = demoMode || (sessionGroupwareEnabled && envFilesEnabled);
  const appsEnabled = demoMode || (sessionGroupwareEnabled && envAppsEnabled);

  // The builders console follows the active account's Inbox entitlement.
  const buildersCookie = slot === 0 ? request.cookies.get('builders_enabled')?.value : undefined;
  const buildersEnabled = demoMode || (session?.buildersEnabled ?? (buildersCookie === '1'));

  // Demo mode enables the BYOMC section
  // so the demo can show the full connect-a-mail-client UI even though prod
  // defaults it off — same rationale as the groupware gates above. The host
  // values + app-password URL are NOT demo-faked: an empty value stays empty
  // (config-missing notice / absent block), never fabricated.
  const byomcEnabled = demoMode || configManager.get<boolean>('byomcEnabled', false);
  const byomcImapHost = configManager.get<string>('byomcImapHost', '');
  const byomcSmtpHost = configManager.get<string>('byomcSmtpHost', '');
  const byomcAppPasswordApiUrl = configManager.get<string>('byomcAppPasswordApiUrl', '');
  // atproto-SSO surface gates. Default ON for vanilla
  // deployments; Comail sets PASSWORD_SECURITY_ENABLED=false and
  // SMIME_ENABLED=false to hide the password-change / S/MIME certificate
  // settings surfaces that don't apply to atproto-SSO members.
  const passwordSecurityEnabled = configManager.get<boolean>('passwordSecurityEnabled', true);
  const smimeEnabled = configManager.get<boolean>('smimeEnabled', true);

  return NextResponse.json(
    {
      appName,
      jmapServerUrl,
      oauthEnabled,
      oauthOnly,
      oauthClientId: configManager.get<string>('oauthClientId', ''),
      oauthIssuerUrl: configManager.get<string>('oauthIssuerUrl', ''),
      oauthScopes: getOauthScopes(),
      rememberMeEnabled: hasSessionSecret(),
      settingsSyncEnabled: configManager.get<boolean>('settingsSyncEnabled', false) && hasSessionSecret(),
      stalwartFeaturesEnabled,
      identityManagementEnabled,
      stalwartJmapPassthroughEnabled,
      devMode: configManager.get<boolean>('devMode', false),
      faviconUrl: branded<string>('faviconUrl', '/branding/comail/comail-favicon.png'),
      appLogoLightUrl: branded<string>('appLogoLightUrl', '/branding/comail/cammie-mark.png'),
      appLogoDarkUrl: branded<string>('appLogoDarkUrl', '/branding/comail/cammie-mark.png'),
      loginLogoLightUrl: branded<string>('loginLogoLightUrl', '/branding/comail/cammie-mark.png'),
      loginLogoDarkUrl: branded<string>('loginLogoDarkUrl', '/branding/comail/cammie-mark.png'),
      loginCompanyName: branded<string>('loginCompanyName', ''),
      loginImprintUrl: branded<string>('loginImprintUrl', ''),
      loginPrivacyPolicyUrl: branded<string>('loginPrivacyPolicyUrl', ''),
      loginWebsiteUrl: branded<string>('loginWebsiteUrl', ''),
      loginLogoMaxHeight: configManager.get<string>('loginLogoMaxHeight', ''),
      loginLogoMaxWidth: configManager.get<string>('loginLogoMaxWidth', ''),
      loginShowHeading: configManager.get<boolean>('loginShowHeading', true),
      loginShowSubtitle: configManager.get<boolean>('loginShowSubtitle', true),
      demoMode,
      calendarEnabled,
      contactsEnabled,
      filesEnabled,
      appsEnabled,
      passwordSecurityEnabled,
      smimeEnabled,
      loginShowTotp: configManager.get<boolean>('loginShowTotp', true),
      loginShowTokenLogin: configManager.get<boolean>('loginShowTokenLogin', false),
      loginShowVersion: configManager.get<boolean>('loginShowVersion', true),
      allowCustomJmapEndpoint: configManager.get<boolean>('allowCustomJmapEndpoint', false),
      // The domain lists name every organisation served here; the login page
      // only needs them to pick the server by the typed address.
      jmapServers: redactJmapServers(parseJmapServers(configManager.get<unknown>('jmapServers', [])))
        .map((server) => (autoPickByDomain ? server : { ...server, domains: [] })),
      jmapServerAutoPickByDomain: autoPickByDomain,
      autoSsoEnabled: configManager.get<boolean>('autoSsoEnabled', false),
      atprotoLoginUrl: configManager.get<string>('atprotoLoginUrl', ''),
      embeddedMode: !!allowedFrameAncestors && allowedFrameAncestors !== "'none'",
      parentOrigin: configManager.get<string>('parentOrigin', ''),
      byomcEnabled,
      byomcImapHost,
      byomcSmtpHost,
      byomcAppPasswordApiUrl,
      buildersEnabled,
      sourceCodeUrl: httpUrlOrEmpty(configManager.get<string>('sourceCodeUrl', '')),
    },
    {
      // Runtime settings can change without new asset URLs. Prevent stale
      // browser/proxy responses, retaining Vary for host-specific branding.
      headers: {
        Vary: 'Host, X-Forwarded-Host',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store',
      },
    },
  );
}
