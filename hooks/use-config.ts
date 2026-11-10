"use client";

import { useState, useEffect } from 'react';
import { usePolicyStore } from '@/stores/policy-store';
import { useAccountStore } from '@/stores/account-store';
import { apiFetch } from '@/lib/browser-navigation';
import type { PublicJmapServerEntry } from '@/lib/admin/jmap-servers';
import { IS_LITE, IS_LITE_STALWART, LITE_CONFIG_PATH, withLiteBuildId } from '@/lib/lite';
import { applyLiteConfig, liteStalwartDefaults } from '@/lib/lite-config';
import { publishConfig } from '@/lib/groupware/config-events';
import { isConfigData } from '@/lib/config-validation';
import { setNoThirdPartyTraffic } from '@/lib/third-party-mode';
import { configureErrorReporting, type ClientSettings } from '@/lib/error-reporting/client';

export interface ConfigData {
  appName: string;
  jmapServerUrl: string;
  oauthEnabled: boolean;
  oauthOnly: boolean;
  oauthClientId: string;
  oauthIssuerUrl: string;
  oauthScopes: string;
  oauthResource: string;
  rememberMeEnabled: boolean;
  settingsSyncEnabled: boolean;
  stalwartFeaturesEnabled: boolean;
  identityManagementEnabled: boolean;
  stalwartJmapPassthroughEnabled: boolean;
  devMode: boolean;
  faviconUrl: string;
  appLogoLightUrl: string;
  appLogoDarkUrl: string;
  loginLogoLightUrl: string;
  loginLogoDarkUrl: string;
  loginCompanyName: string;
  loginImprintUrl: string;
  loginPrivacyPolicyUrl: string;
  loginWebsiteUrl: string;
  buildersWebsiteUrl?: string;
  loginUsernamePlaceholder: string;
  hostedInboxLogoutDestination?: string;
  loginLogoMaxHeight: string;
  loginLogoMaxWidth: string;
  loginShowHeading: boolean;
  loginShowSubtitle: boolean;
  loginShowTotp: boolean;
  loginShowTokenLogin: boolean;
  loginShowRememberMe: boolean;
  loginShowVersion: boolean;
  demoMode: boolean;
  calendarEnabled: boolean;
  privateCalendarEnabled?: boolean;
  privateContactsEnabled?: boolean;
  privateFilesEnabled?: boolean;
  contactsEnabled: boolean;
  filesEnabled: boolean;
  appsEnabled: boolean;
  // atproto-SSO surface gates. Default ON for vanilla
  // deployments; Comail sets both to false to hide the password-change /
  // S/MIME certificate settings surfaces for atproto-SSO members.
  passwordSecurityEnabled: boolean;
  smimeEnabled: boolean;
  autoSsoEnabled: boolean;
  atprotoLoginUrl: string;
  allowCustomJmapEndpoint: boolean;
  jmapServers: PublicJmapServerEntry[];
  jmapServerAutoPickByDomain: boolean;
  embeddedMode: boolean;
  parentOrigin: string;
  byomcEnabled: boolean;
  byomcImapHost: string;
  byomcSmtpHost: string;
  byomcAppPasswordApiUrl: string;
  buildersEnabled: boolean;
  sourceCodeUrl: string;
  /** Accessibility and help links (lib/help-links.ts); '' hides a link. */
  accessibilityStatementUrl: string;
  accessibilityFeedbackUrl: string;
  helpUrl: string;
  easyReadUrl: string;
  signLanguageUrl: string;
  /** Stay off every built-in outside host (#903; lib/outgoing-hosts.ts). */
  noThirdPartyTraffic: boolean;
  /** Lite only: whether sign-out revokes the refresh token (#1388). The server build decides in its token route. */
  oauthRevokeOnSignOut?: boolean;
  /** Server build only; Lite reads it from policy.json (stores/policy-store.ts). */
  errorReporting?: ClientSettings;
}

interface AppConfig extends ConfigData {
  buildersWebsiteUrl: string;
  isLoading: boolean;
  error: string | null;
}

let configCache: ConfigData | null = null;
let configSlot: number | null = null;
let configAccountId: string | null = null;
let configGeneration = 0;

function activeConfigSlot(): number {
  return useAccountStore.getState().getActiveAccount()?.cookieSlot ?? 0;
}
let configPromise: Promise<ConfigData> | null = null;

/**
 * Static Lite build: the deployer-edited config.json next to index.html
 * replaces /api/config. A missing or broken file falls back to the defaults
 * (custom endpoint allowed) so an unedited download still lets people sign in.
 */
async function fetchLiteConfig(): Promise<ConfigData> {
  // On Stalwart the bundle is read-only and served from the JMAP origin:
  // config.json ships inside the zip (build-id URL, immutable cache) and an
  // empty server URL means "this origin".
  const defaults = IS_LITE_STALWART ? liteStalwartDefaults() : undefined;
  try {
    const res = await apiFetch(withLiteBuildId(LITE_CONFIG_PATH), IS_LITE_STALWART ? undefined : { cache: 'no-store' });
    if (!res.ok) throw new Error(`config.json answered ${res.status}`);
    return applyLiteConfig(await res.json(), defaults);
  } catch (err) {
    // Fail closed (#903): without a readable config.json nobody said outside
    // hosts may be used, so the no-third-party switches stay on.
    console.warn('[lite] config.json missing or invalid, using defaults with no third-party traffic:', err);
    return applyLiteConfig({ noThirdPartyTraffic: true }, defaults);
  }
}

const CONFIG_ATTEMPT_DELAYS_MS = [0, 500, 1500] as const;
const CONFIG_TIMEOUT_MS = 10000;

async function fetchServerConfig(slot: number): Promise<ConfigData> {
  let lastError: unknown;
  for (const delay of CONFIG_ATTEMPT_DELAYS_MS) {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    const controller = new AbortController();
    // Keep the timeout active while reading the body, not only the headers.
    const timeout = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
    try {
      const response = await apiFetch('/api/config', {
        cache: 'no-store',
        headers: { 'X-JMAP-Cookie-Slot': String(slot) },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Failed to fetch config (${response.status})`);
      const payload: unknown = await response.json();
      // The previous server release omits this display flag during rollback.
      const data = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? { loginShowRememberMe: false, ...payload }
        : payload;
      if (!isConfigData(data)) {
        throw new Error('Invalid application configuration');
      }
      return data;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

/** Read an inactive account without replacing the active account's cache. */
export function fetchAccountConfig(slot: number): Promise<ConfigData> {
  return fetchServerConfig(slot);
}

/** Test hook: forget the cached config so the next fetch hits the network again. */
export function resetConfigCache(): void {
  configCache = null;
  configPromise = null;
  configGeneration += 1;
}

export function getCachedConfig(slot?: number): ConfigData | null {
  // Logout reads public destination settings after removing the account.
  if (slot === undefined) return configCache;
  if (!configCache || (slot !== undefined && configSlot !== slot)) return null;
  const account = useAccountStore.getState().getActiveAccount();
  if ((account?.cookieSlot ?? 0) !== configSlot) return null;
  return (account?.id ?? null) === configAccountId ? configCache : null;
}

export async function fetchConfig(): Promise<ConfigData> {
  const slot = activeConfigSlot();
  const accountId = useAccountStore.getState().getActiveAccount()?.id ?? null;
  if (configSlot !== slot || configAccountId !== accountId) {
    resetConfigCache();
    configSlot = slot;
    configAccountId = accountId;
  }
  // Return cached config if available
  if (configCache) {
    return configCache;
  }

  // If a fetch is already in progress, wait for it
  if (configPromise) {
    return configPromise;
  }

  // Start a new fetch
  const generation = configGeneration;
  configPromise = (IS_LITE ? fetchLiteConfig() : fetchServerConfig(slot))
    .then((data) => {
      if (configGeneration === generation && configSlot === slot) {
        configCache = data;
        setNoThirdPartyTraffic(data.noThirdPartyTraffic === true);
        publishConfig(data, slot);
        if (!IS_LITE) configureErrorReporting(data.errorReporting ?? null);
      }
      // Fetch admin policy alongside config (non-blocking)
      usePolicyStore.getState().fetchPolicy();
      return data;
    })
    .finally(() => {
      if (configGeneration === generation && configSlot === slot) configPromise = null;
    });

  return configPromise;
}

/**
 * Hook to fetch runtime configuration
 *
 * Fetches app configuration from /api/config endpoint, which reads
 * environment variables at runtime (not build time).
 *
 * The config is cached after first fetch to avoid unnecessary requests.
 */
export function useConfig(): AppConfig {
  const slot = useAccountStore(state => state.getActiveAccount()?.cookieSlot ?? 0);
  const accountId = useAccountStore(state => state.activeAccountId);
  const owner = `${accountId ?? 'anonymous'}:${slot}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Match server markup even if another consumer warms the cache before hydration.
  const [config, setConfig] = useState<AppConfig>({
    appName: 'Webmail',
    jmapServerUrl: '',
    oauthEnabled: false,
    oauthOnly: false,
    oauthClientId: '',
    oauthIssuerUrl: '',
    oauthScopes: '',
    oauthResource: '',
    rememberMeEnabled: false,
    settingsSyncEnabled: false,
    stalwartFeaturesEnabled: true,
    identityManagementEnabled: true,
    stalwartJmapPassthroughEnabled: true,
    devMode: false,
    faviconUrl: '/branding/comail/comail-favicon.png',
    appLogoLightUrl: '/branding/comail/cammie-mark.png',
    appLogoDarkUrl: '/branding/comail/cammie-mark.png',
    loginLogoLightUrl: '/branding/comail/cammie-mark.png',
    loginLogoDarkUrl: '/branding/comail/cammie-mark.png',
    loginCompanyName: '',
    loginImprintUrl: '',
    loginPrivacyPolicyUrl: '',
    loginWebsiteUrl: '',
    buildersWebsiteUrl: 'https://build.comail.at',
    hostedInboxLogoutDestination: '',
    loginUsernamePlaceholder: '',
    loginLogoMaxHeight: '',
    loginLogoMaxWidth: '',
    loginShowHeading: true,
    loginShowSubtitle: true,
    loginShowTotp: true,
    loginShowTokenLogin: false,
    loginShowRememberMe: false,
    loginShowVersion: true,
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
    buildersEnabled: false,
    sourceCodeUrl: '',
    accessibilityStatementUrl: '',
    accessibilityFeedbackUrl: '',
    helpUrl: '',
    easyReadUrl: '',
    signLanguageUrl: '',
    noThirdPartyTraffic: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    // If already cached, no need to fetch
    const cached = getCachedConfig(slot);
    if (cached) {
      setLoadedFor(owner);
      setConfig({
        appName: cached.appName,
        jmapServerUrl: cached.jmapServerUrl,
        oauthEnabled: cached.oauthEnabled,
        oauthOnly: cached.oauthOnly,
        oauthClientId: cached.oauthClientId,
        oauthIssuerUrl: cached.oauthIssuerUrl,
        oauthScopes: cached.oauthScopes,
        oauthResource: cached.oauthResource,
        rememberMeEnabled: cached.rememberMeEnabled,
        settingsSyncEnabled: cached.settingsSyncEnabled,
        stalwartFeaturesEnabled: cached.stalwartFeaturesEnabled,
        identityManagementEnabled: cached.identityManagementEnabled ?? true,
        stalwartJmapPassthroughEnabled: cached.stalwartJmapPassthroughEnabled,
        devMode: cached.devMode,
        faviconUrl: cached.faviconUrl,
        appLogoLightUrl: cached.appLogoLightUrl,
        appLogoDarkUrl: cached.appLogoDarkUrl,
        loginLogoLightUrl: cached.loginLogoLightUrl,
        loginLogoDarkUrl: cached.loginLogoDarkUrl,
        loginCompanyName: cached.loginCompanyName,
        loginImprintUrl: cached.loginImprintUrl,
        loginPrivacyPolicyUrl: cached.loginPrivacyPolicyUrl,
        loginWebsiteUrl: cached.loginWebsiteUrl,
        buildersWebsiteUrl: cached.buildersWebsiteUrl || 'https://build.comail.at',
        loginUsernamePlaceholder: cached.loginUsernamePlaceholder,
        hostedInboxLogoutDestination: cached.hostedInboxLogoutDestination || '',
        loginLogoMaxHeight: cached.loginLogoMaxHeight,
        loginLogoMaxWidth: cached.loginLogoMaxWidth,
        loginShowHeading: cached.loginShowHeading,
        loginShowSubtitle: cached.loginShowSubtitle,
        loginShowTotp: cached.loginShowTotp,
        loginShowTokenLogin: cached.loginShowTokenLogin,
        loginShowRememberMe: cached.loginShowRememberMe,
        loginShowVersion: cached.loginShowVersion,
        demoMode: cached.demoMode,
        calendarEnabled: cached.calendarEnabled,
        contactsEnabled: cached.contactsEnabled,
        filesEnabled: cached.filesEnabled,
        appsEnabled: cached.appsEnabled,
        passwordSecurityEnabled: cached.passwordSecurityEnabled,
        smimeEnabled: cached.smimeEnabled,
        autoSsoEnabled: cached.autoSsoEnabled,
        atprotoLoginUrl: cached.atprotoLoginUrl,
        allowCustomJmapEndpoint: cached.allowCustomJmapEndpoint,
        jmapServers: cached.jmapServers || [],
        jmapServerAutoPickByDomain: cached.jmapServerAutoPickByDomain || false,
        embeddedMode: cached.embeddedMode,
        parentOrigin: cached.parentOrigin,
        byomcEnabled: cached.byomcEnabled,
        byomcImapHost: cached.byomcImapHost,
        byomcSmtpHost: cached.byomcSmtpHost,
        byomcAppPasswordApiUrl: cached.byomcAppPasswordApiUrl,
        buildersEnabled: cached.buildersEnabled,
        sourceCodeUrl: cached.sourceCodeUrl,
        accessibilityStatementUrl: cached.accessibilityStatementUrl,
        accessibilityFeedbackUrl: cached.accessibilityFeedbackUrl,
        helpUrl: cached.helpUrl,
        easyReadUrl: cached.easyReadUrl,
        signLanguageUrl: cached.signLanguageUrl,
        noThirdPartyTraffic: cached.noThirdPartyTraffic,
        isLoading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    fetchConfig()
      .then((data) => {
        if (cancelled) return;
        setLoadedFor(owner);
        setConfig({
          appName: data.appName,
          jmapServerUrl: data.jmapServerUrl,
          oauthEnabled: data.oauthEnabled,
          oauthOnly: data.oauthOnly,
          oauthClientId: data.oauthClientId,
          oauthIssuerUrl: data.oauthIssuerUrl,
          oauthScopes: data.oauthScopes,
          oauthResource: data.oauthResource,
          rememberMeEnabled: data.rememberMeEnabled,
          settingsSyncEnabled: data.settingsSyncEnabled,
          stalwartFeaturesEnabled: data.stalwartFeaturesEnabled,
          identityManagementEnabled: data.identityManagementEnabled ?? true,
          stalwartJmapPassthroughEnabled: data.stalwartJmapPassthroughEnabled,
          devMode: data.devMode,
          faviconUrl: data.faviconUrl,
          appLogoLightUrl: data.appLogoLightUrl,
          appLogoDarkUrl: data.appLogoDarkUrl,
          loginLogoLightUrl: data.loginLogoLightUrl,
          loginLogoDarkUrl: data.loginLogoDarkUrl,
          loginCompanyName: data.loginCompanyName,
          loginImprintUrl: data.loginImprintUrl,
          loginPrivacyPolicyUrl: data.loginPrivacyPolicyUrl,
          loginWebsiteUrl: data.loginWebsiteUrl,
          buildersWebsiteUrl: data.buildersWebsiteUrl || 'https://build.comail.at',
          loginUsernamePlaceholder: data.loginUsernamePlaceholder,
          hostedInboxLogoutDestination: data.hostedInboxLogoutDestination || '',
          loginLogoMaxHeight: data.loginLogoMaxHeight,
          loginLogoMaxWidth: data.loginLogoMaxWidth,
          loginShowHeading: data.loginShowHeading,
          loginShowSubtitle: data.loginShowSubtitle,
          loginShowTotp: data.loginShowTotp,
          loginShowTokenLogin: data.loginShowTokenLogin,
          loginShowRememberMe: data.loginShowRememberMe,
          loginShowVersion: data.loginShowVersion,
          demoMode: data.demoMode,
          calendarEnabled: data.calendarEnabled,
          contactsEnabled: data.contactsEnabled,
          filesEnabled: data.filesEnabled,
          appsEnabled: data.appsEnabled,
          passwordSecurityEnabled: data.passwordSecurityEnabled,
          smimeEnabled: data.smimeEnabled,
          autoSsoEnabled: data.autoSsoEnabled,
          atprotoLoginUrl: data.atprotoLoginUrl,
          allowCustomJmapEndpoint: data.allowCustomJmapEndpoint,
          jmapServers: data.jmapServers || [],
          jmapServerAutoPickByDomain: data.jmapServerAutoPickByDomain || false,
          embeddedMode: data.embeddedMode,
          parentOrigin: data.parentOrigin,
          byomcEnabled: data.byomcEnabled,
          byomcImapHost: data.byomcImapHost,
          byomcSmtpHost: data.byomcSmtpHost,
          byomcAppPasswordApiUrl: data.byomcAppPasswordApiUrl,
          buildersEnabled: data.buildersEnabled,
          sourceCodeUrl: data.sourceCodeUrl,
          accessibilityStatementUrl: data.accessibilityStatementUrl,
          accessibilityFeedbackUrl: data.accessibilityFeedbackUrl,
          helpUrl: data.helpUrl,
          easyReadUrl: data.easyReadUrl,
          signLanguageUrl: data.signLanguageUrl,
          noThirdPartyTraffic: data.noThirdPartyTraffic,
          isLoading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadedFor(owner);
        setConfig((prev) => ({
          ...prev,
          isLoading: false,
          error: err.message,
        }));
      });
    return () => { cancelled = true; };
  }, [slot, owner]);

  return loadedFor === owner ? config : { ...config, isLoading: true, error: null };
}
