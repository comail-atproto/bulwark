"use client";

import { useState, useEffect } from 'react';
import { usePolicyStore } from '@/stores/policy-store';
import { useAccountStore } from '@/stores/account-store';
import { apiFetch } from '@/lib/browser-navigation';
import type { PublicJmapServerEntry } from '@/lib/admin/jmap-servers';
import { IS_LITE, IS_LITE_STALWART, LITE_CONFIG_PATH, withLiteBuildId } from '@/lib/lite';
import { applyLiteConfig, liteStalwartDefaults } from '@/lib/lite-config';
import { isConfigData } from '@/lib/config-validation';

export interface ConfigData {
  appName: string;
  jmapServerUrl: string;
  oauthEnabled: boolean;
  oauthOnly: boolean;
  oauthClientId: string;
  oauthIssuerUrl: string;
  oauthScopes: string;
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
  loginLogoMaxHeight: string;
  loginLogoMaxWidth: string;
  loginShowHeading: boolean;
  loginShowSubtitle: boolean;
  loginShowTotp: boolean;
  loginShowTokenLogin: boolean;
  loginShowVersion: boolean;
  demoMode: boolean;
  calendarEnabled: boolean;
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
}

interface AppConfig extends ConfigData {
  isLoading: boolean;
  error: string | null;
}

let configCache: ConfigData | null = null;
let configSlot: number | null = null;

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
    console.warn('[lite] config.json missing or invalid, using defaults:', err);
    return applyLiteConfig({}, defaults);
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
      const data: unknown = await response.json();
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

/** Test hook: forget the cached config so the next fetch hits the network again. */
export function resetConfigCache(): void {
  configCache = null;
  configPromise = null;
}

export async function fetchConfig(): Promise<ConfigData> {
  const slot = activeConfigSlot();
  if (configSlot !== slot) {
    resetConfigCache();
    configSlot = slot;
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
  configPromise = (IS_LITE ? fetchLiteConfig() : fetchServerConfig(slot))
    .then((data) => {
      if (configSlot === slot) configCache = data;
      // Fetch admin policy alongside config (non-blocking)
      usePolicyStore.getState().fetchPolicy();
      return data;
    })
    .finally(() => {
      if (configSlot === slot) configPromise = null;
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
  const [config, setConfig] = useState<AppConfig>({
    appName: configCache?.appName || 'Webmail',
    jmapServerUrl: configCache?.jmapServerUrl || '',
    oauthEnabled: configCache?.oauthEnabled || false,
    oauthOnly: configCache?.oauthOnly || false,
    oauthClientId: configCache?.oauthClientId || '',
    oauthIssuerUrl: configCache?.oauthIssuerUrl || '',
    oauthScopes: configCache?.oauthScopes || '',
    rememberMeEnabled: configCache?.rememberMeEnabled || false,
    settingsSyncEnabled: configCache?.settingsSyncEnabled || false,
    stalwartFeaturesEnabled: configCache?.stalwartFeaturesEnabled ?? true,
    identityManagementEnabled: configCache?.identityManagementEnabled ?? true,
    stalwartJmapPassthroughEnabled: configCache?.stalwartJmapPassthroughEnabled ?? true,
    devMode: configCache?.devMode || false,
    faviconUrl: configCache?.faviconUrl || '/branding/comail/comail-favicon.png',
    appLogoLightUrl: configCache?.appLogoLightUrl || '/branding/comail/cammie-mark.png',
    appLogoDarkUrl: configCache?.appLogoDarkUrl || '/branding/comail/cammie-mark.png',
    loginLogoLightUrl: configCache?.loginLogoLightUrl || '/branding/comail/cammie-mark.png',
    loginLogoDarkUrl: configCache?.loginLogoDarkUrl || '/branding/comail/cammie-mark.png',
    loginCompanyName: configCache?.loginCompanyName || '',
    loginImprintUrl: configCache?.loginImprintUrl || '',
    loginPrivacyPolicyUrl: configCache?.loginPrivacyPolicyUrl || '',
    loginWebsiteUrl: configCache?.loginWebsiteUrl || '',
    loginLogoMaxHeight: configCache?.loginLogoMaxHeight || '',
    loginLogoMaxWidth: configCache?.loginLogoMaxWidth || '',
    loginShowHeading: configCache?.loginShowHeading ?? true,
    loginShowSubtitle: configCache?.loginShowSubtitle ?? true,
    loginShowTotp: configCache?.loginShowTotp ?? true,
    loginShowTokenLogin: configCache?.loginShowTokenLogin ?? false,
    loginShowVersion: configCache?.loginShowVersion ?? true,
    demoMode: configCache?.demoMode || false,
    calendarEnabled: configCache?.calendarEnabled || false,
    contactsEnabled: configCache?.contactsEnabled || false,
    filesEnabled: configCache?.filesEnabled || false,
    appsEnabled: configCache?.appsEnabled || false,
    passwordSecurityEnabled: configCache?.passwordSecurityEnabled ?? true,
    smimeEnabled: configCache?.smimeEnabled ?? true,
    autoSsoEnabled: configCache?.autoSsoEnabled || false,
    atprotoLoginUrl: configCache?.atprotoLoginUrl || '',
    allowCustomJmapEndpoint: configCache?.allowCustomJmapEndpoint || false,
    jmapServers: configCache?.jmapServers || [],
    jmapServerAutoPickByDomain: configCache?.jmapServerAutoPickByDomain || false,
    embeddedMode: configCache?.embeddedMode || false,
    parentOrigin: configCache?.parentOrigin || '',
    byomcEnabled: configCache?.byomcEnabled || false,
    byomcImapHost: configCache?.byomcImapHost || '',
    byomcSmtpHost: configCache?.byomcSmtpHost || '',
    byomcAppPasswordApiUrl: configCache?.byomcAppPasswordApiUrl || '',
    buildersEnabled: configCache?.buildersEnabled || false,
    sourceCodeUrl: configCache?.sourceCodeUrl || '',
    isLoading: !configCache,
    error: null,
  });

  useEffect(() => {
    // If already cached, no need to fetch
    if (configCache && configSlot === slot) {
      setConfig({
        appName: configCache.appName,
        jmapServerUrl: configCache.jmapServerUrl,
        oauthEnabled: configCache.oauthEnabled,
        oauthOnly: configCache.oauthOnly,
        oauthClientId: configCache.oauthClientId,
        oauthIssuerUrl: configCache.oauthIssuerUrl,
        oauthScopes: configCache.oauthScopes,
        rememberMeEnabled: configCache.rememberMeEnabled,
        settingsSyncEnabled: configCache.settingsSyncEnabled,
        stalwartFeaturesEnabled: configCache.stalwartFeaturesEnabled,
        identityManagementEnabled: configCache.identityManagementEnabled ?? true,
        stalwartJmapPassthroughEnabled: configCache.stalwartJmapPassthroughEnabled,
        devMode: configCache.devMode,
        faviconUrl: configCache.faviconUrl,
        appLogoLightUrl: configCache.appLogoLightUrl,
        appLogoDarkUrl: configCache.appLogoDarkUrl,
        loginLogoLightUrl: configCache.loginLogoLightUrl,
        loginLogoDarkUrl: configCache.loginLogoDarkUrl,
        loginCompanyName: configCache.loginCompanyName,
        loginImprintUrl: configCache.loginImprintUrl,
        loginPrivacyPolicyUrl: configCache.loginPrivacyPolicyUrl,
        loginWebsiteUrl: configCache.loginWebsiteUrl,
        loginLogoMaxHeight: configCache.loginLogoMaxHeight,
        loginLogoMaxWidth: configCache.loginLogoMaxWidth,
        loginShowHeading: configCache.loginShowHeading,
        loginShowSubtitle: configCache.loginShowSubtitle,
        loginShowTotp: configCache.loginShowTotp,
        loginShowTokenLogin: configCache.loginShowTokenLogin,
        loginShowVersion: configCache.loginShowVersion,
        demoMode: configCache.demoMode,
        calendarEnabled: configCache.calendarEnabled,
        contactsEnabled: configCache.contactsEnabled,
        filesEnabled: configCache.filesEnabled,
        appsEnabled: configCache.appsEnabled,
        passwordSecurityEnabled: configCache.passwordSecurityEnabled,
        smimeEnabled: configCache.smimeEnabled,
        autoSsoEnabled: configCache.autoSsoEnabled,
        atprotoLoginUrl: configCache.atprotoLoginUrl,
        allowCustomJmapEndpoint: configCache.allowCustomJmapEndpoint,
        jmapServers: configCache.jmapServers || [],
        jmapServerAutoPickByDomain: configCache.jmapServerAutoPickByDomain || false,
        embeddedMode: configCache.embeddedMode,
        parentOrigin: configCache.parentOrigin,
        byomcEnabled: configCache.byomcEnabled,
        byomcImapHost: configCache.byomcImapHost,
        byomcSmtpHost: configCache.byomcSmtpHost,
        byomcAppPasswordApiUrl: configCache.byomcAppPasswordApiUrl,
        buildersEnabled: configCache.buildersEnabled,
        sourceCodeUrl: configCache.sourceCodeUrl,
        isLoading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    fetchConfig()
      .then((data) => {
        if (cancelled) return;
        setConfig({
          appName: data.appName,
          jmapServerUrl: data.jmapServerUrl,
          oauthEnabled: data.oauthEnabled,
          oauthOnly: data.oauthOnly,
          oauthClientId: data.oauthClientId,
          oauthIssuerUrl: data.oauthIssuerUrl,
          oauthScopes: data.oauthScopes,
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
          loginLogoMaxHeight: data.loginLogoMaxHeight,
          loginLogoMaxWidth: data.loginLogoMaxWidth,
          loginShowHeading: data.loginShowHeading,
          loginShowSubtitle: data.loginShowSubtitle,
          loginShowTotp: data.loginShowTotp,
          loginShowTokenLogin: data.loginShowTokenLogin,
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
          isLoading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setConfig((prev) => ({
          ...prev,
          isLoading: false,
          error: err.message,
        }));
      });
    return () => { cancelled = true; };
  }, [slot]);

  return config;
}
