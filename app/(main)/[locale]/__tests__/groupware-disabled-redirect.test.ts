import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Finding 1: all three groupware routes — Calendar, Contacts, Files — must
// behave the SAME when their feature flag is disabled: REDIRECT to '/' (what
// the PR description promises) and render nothing inline. Previously Contacts
// and Files rendered an inline "disabled" card while Calendar redirected.
//
// Finding 2: the Contacts settings tab must gate on supportsContacts for
// symmetry with Calendar (supportsCalendar) and Files (supportsFiles) —
// matching how navigation-rail.tsx gates contacts.
//
// These page components are ~1k–3k-line client components wired to many
// stores/routers; rendering them in jsdom is impractical (see landmarks.test
// for the same rationale). We assert the redirect effect + `return null` +
// the supportsContacts gate exist in source. Calendar is the reference
// implementation for the redirect shape.

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = resolve(here, '..', '..', '..', '..', 'components');
const calendarSrc = readFileSync(resolve(componentsDir, 'calendar', 'calendar-app.tsx'), 'utf8');
const contactsSrc = readFileSync(resolve(componentsDir, 'contacts', 'contacts-app.tsx'), 'utf8');
const filesSrc = readFileSync(resolve(componentsDir, 'files', 'files-app.tsx'), 'utf8');
const settingsSrc = readFileSync(resolve(componentsDir, 'settings', 'settings-app.tsx'), 'utf8');

const ROUTES: Array<{ name: string; src: string; flag: string }> = [
  { name: 'Calendar', src: calendarSrc, flag: 'calendarEnabled' },
  { name: 'Contacts', src: contactsSrc, flag: 'contactsEnabled' },
  { name: 'Files', src: filesSrc, flag: 'filesEnabled' },
];

describe('groupware routes: uniform disabled-redirect (PR #1776, #1766)', () => {
  for (const route of ROUTES) {
    describe(`${route.name} route`, () => {
      it('redirects to "/" via router.push when the flag is disabled', () => {
        // The redirect lives in the auth/redirect effect (mirrors Calendar):
        // `else if (client && !<flag>) { router.push("/"); }`
        const redirectRe = new RegExp(
          `else if \\(client && !${route.flag}\\)\\s*\\{[\\s\\S]*?router\\.push\\("/"\\);[\\s\\S]*?\\}`,
        );
        expect(
          redirectRe.test(route.src),
          `${route.name} must redirect to "/" when ${route.flag} is false`,
        ).toBe(true);
      });

      it('renders nothing (return null) when the flag is disabled', () => {
        // Calendar uses `if (!calendarEnabled) return null;`. Contacts/Files
        // must mirror that instead of an inline disabled-card.
        const returnNullRe = new RegExp(`if \\([^\\n]*!${route.flag}[^\\n]*\\)\\s*return null;`);
        expect(
          returnNullRe.test(route.src),
          `${route.name} must \`return null\` when ${route.flag} is false`,
        ).toBe(true);
      });
    });
  }

  it('Contacts no longer renders an inline "disabled" card', () => {
    // The old inline disabled-card copy must be gone (redirect replaces it).
    expect(contactsSrc).not.toContain('Contacts feature is disabled by your administrator');
    // AlertTriangle was only used by the deleted disabled-card; the import must
    // be gone (it would otherwise be an unused import).
    expect(contactsSrc).not.toMatch(/import\s*\{[^}]*AlertTriangle[^}]*\}\s*from\s*"lucide-react"/);
  });

  it('Files no longer renders an inline "disabled" card for the flag-disabled branch', () => {
    // The `!filesEnabled` JSX branch must be gone entirely because the early
    // return handles it; only the capability card remains.
    expect(filesSrc).not.toContain('disabled_title');
    expect(filesSrc).not.toContain('disabled_description');
    expect(filesSrc).not.toMatch(/\{!filesEnabled\s*\?/);
    expect(filesSrc).toContain('{supportsFiles === false ? (');
  });
});

describe('Contacts settings tab gates on supportsContacts (PR #1776, #1766)', () => {
  it('computes supportsContacts from the JMAP client', () => {
    expect(settingsSrc).toContain('const supportsContacts = client?.supportsContacts() ?? false;');
  });

  it('AND-gates the Contacts settings tab on supportsContacts (unscoped)', () => {
    // Mirror of `calendarConfigEnabled && supportsCalendar && isFeatureEnabled('calendarEnabled')`.
    expect(settingsSrc).toContain(
      'contactsConfigEnabled && supportsContacts && isFeatureEnabled(\'contactsEnabled\')',
    );
  });

  it('AND-gates the Contacts scoped (managed-account) tab on supportsContacts', () => {
    // Mirror of the calendar scoped line which includes `supportsCalendar`.
    expect(settingsSrc).toContain(
      'managedAccount.capabilities.contacts && contactsConfigEnabled && supportsContacts && isFeatureEnabled(\'contactsEnabled\')',
    );
  });
});

// BYOMC — "bring your own mail client" (atmosphere-mail #1791). The Settings →
// Mail → "Connect a mail client" tab is env-gated on byomcEnabled (force-on in
// demo mode, same as the groupware gates). When the flag is off the tab must be
// absent from the tab list entirely, which also removes it from the search
// index (its haystack is built only for tabs present in tabSearchPaths, and
// the tab def is only pushed when byomcEnabled is true). Source-text assertions
// mirror the groupware-gate style above — rendering the 1k-line settings page
// in jsdom is impractical (see landmarks/groupware tests for the same call).
describe('BYOMC settings tab gating (atmosphere-mail #1791)', () => {
  it('registers the byomc tab in the Mail group behind byomcEnabled', () => {
    // The tab def is conditionally spread only when byomcEnabled is true, so a
    // flag-off deployment never exposes the tab.
    expect(settingsSrc).toContain(
      '...(byomcEnabled ? [{ id: \'byomc\' as Tab, label: t(\'tabs.byomc\'), icon: tabIcons.byomc, group: \'mail\' as TabGroup }] : [])',
    );
  });

  it('reads byomcEnabled from useConfig', () => {
    // Destructured from useConfig so the gate is env-driven (and demo-forced).
    // byomcEnabled sits inside the useConfig() destructure; other gates were
    // merged after it, so assert membership rather than last-position.
    expect(settingsSrc).toMatch(/byomcEnabled,\s*\n/);
  });

  it('includes the byomc search path so its haystack is built', () => {
    // tabSearchPaths.byomc points at the settings.byomc translation namespace.
    // The haystack builder iterates Object.keys(tabSearchPaths), so a present
    // entry is what makes the tab searchable. When the tab is flag-gated out of
    // the tab LIST it still has a haystack entry, but matchesQuery only runs
    // against tabs that survive into groupedTabs (visibleTabs → tabs filtered
    // by the conditional spread), so a flag-off tab is never searched.
    expect(readFileSync(resolve(componentsDir, '..', 'lib', 'settings-search.ts'), 'utf8')).toContain("byomc: ['settings.byomc'],");
  });

  it('renders <ByomcSettings /> for the byomc tab', () => {
    expect(settingsSrc).toContain(
      "{effectiveActiveTab === 'byomc' && <ByomcSettings />}",
    );
  });

  it('imports ByomcSettings', () => {
    expect(settingsSrc).toContain(
      "import { ByomcSettings } from '@/components/settings/byomc-settings';",
    );
  });
});

// Regression guard for issue #1789: hide settings surfaces that don't apply to
// Comail's atproto-SSO members. The Security tab already gated on
// `stalwartFeaturesEnabled`; it must ALSO gate on the new
// `passwordSecurityEnabled` config flag. The Encryption (S/MIME) tab gated only
// on the admin policy `isFeatureEnabled('smimeEnabled')`; it must ALSO gate on
// the new `smimeEnabled` config flag. Both must be absent from the tab list
// (and therefore from search) when their config flag is off — there is no
// separate tab-search index to update, search iterates the filtered tab list,
// so gating the tab entry is sufficient (asserted below).
describe('settings: hide atproto-irrelevant surfaces (issue #1789)', () => {
  it('AND-gates the Security tab on stalwartFeaturesEnabled AND passwordSecurityEnabled', () => {
    // The Security tab must require BOTH stalwartFeaturesEnabled (per-server
    // Stalwart features) AND the new passwordSecurityEnabled config flag.
    expect(settingsSrc).toContain(
      'stalwartFeaturesEnabled && passwordSecurityEnabled ? [{ id: \'security\'',
    );
  });

  it('reads passwordSecurityEnabled from useConfig', () => {
    // Destructured alongside the other config-driven gates so the gate is
    // wired to the /api/config response, not a stale constant.
    expect(settingsSrc).toMatch(/passwordSecurityEnabled,?\s*\n/);
  });

  it('filters S/MIME plugin settings when config smimeEnabled is off', () => {
    // Upstream replaced the built-in Encryption tab with plugin-contributed
    // settings sections. Comail still hides any plugin requesting S/MIME
    // permissions when the deployment config disables S/MIME.
    expect(settingsSrc).toContain('if (smimeConfigEnabled) return true;');
    expect(settingsSrc).toContain("permission.startsWith('smime:')");
  });

  it('reads smimeEnabled from useConfig as smimeConfigEnabled', () => {
    // Renamed on destructure to avoid colliding with the policy-store
    // isFeatureEnabled('smimeEnabled') gate (mirrors calendarConfigEnabled).
    expect(settingsSrc).toMatch(/smimeEnabled:\s*smimeConfigEnabled/);
  });
});
