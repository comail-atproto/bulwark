import { mergeConfig } from 'vitest/config';
import upstream from './vitest.config';

// These native suites exercise routing and UI with the feature available.
// Comail denial and account-isolation cases run separately with their own fixtures.
const nativeRoutes = [
  "lib/__tests__/caldav-discover-route.test.ts",
  "lib/__tests__/calendar-agenda-route.test.ts",
  "lib/__tests__/fetch-ical-route.test.ts",
  "lib/__tests__/webdav-route.test.ts",
  "lib/__tests__/wopi-file-routes.test.ts",
  "lib/__tests__/wopi-reverse-proxy.test.ts",
  "lib/__tests__/wopi-shared-file-routes.test.ts"
];
const nativeComponents = [
  "components/email/__tests__/mv-list-toolbar.test.tsx",
  "components/email/__tests__/plugin-row-badges.test.tsx",
  "components/email/__tests__/thread-list-item-account-dot.test.tsx",
  "components/email/__tests__/thread-list-item-source-folder.test.tsx",
  "components/email/__tests__/thread-list-item.test.tsx",
  "components/global-search/__tests__/global-search-palette.test.tsx",
  "components/global-search/__tests__/search-tab-body.test.tsx",
  "components/contacts/__tests__/contacts-app.test.tsx",
  "components/contacts/__tests__/contacts-delete-confirm.test.tsx"
];

export default mergeConfig(upstream, {
  test: {
    setupFiles: ['./vitest.comail.setup.ts'],
    // These scripts run separately under node:test or Playwright.
    exclude: ['scripts/release-assets.test.mjs', 'scripts/verify-source-run.test.mjs', 'scripts/demo-assets/demo-mail.spec.ts'],
    projects: [
      { extends: true, test: { name: 'native-routes', include: nativeRoutes, setupFiles: ['./vitest.native-routes.setup.ts'] } },
      { extends: true, test: { name: 'native-components', include: nativeComponents, setupFiles: ['./vitest.native-components.setup.ts'] } },
      { extends: true, test: { name: 'unit', exclude: [...nativeRoutes, ...nativeComponents] } },
    ],
  },
});
