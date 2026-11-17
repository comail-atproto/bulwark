import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Accessibility budget for the main screens: axe-core's WCAG 2.2 A/AA rules
// (serious and critical only) per screen, plus a few keyboard checks axe
// can't make. Runs against the same production build as the perf guard
// (`DEV_MOCK_JMAP=true npx next build --webpack`) and fails when a screen
// gets more violating nodes than budget.json allows.
//
//   DEV_MOCK_JMAP=true npx next build --webpack
//   npm run test:a11y-guard                       # check
//   A11Y_GUARD_UPDATE=1 npm run test:a11y-guard   # rewrite budget.json
//
// axe.min.js is vendored next to this file (axe-core, MPL-2.0) so the check
// needs no extra dependency.
const port = Number(process.env.A11Y_GUARD_PORT || 3151);
const externalBaseUrl = (process.env.A11Y_GUARD_BASE_URL ?? "").replace(/\/+$/, "");
const adminDir = mkdtempSync(join(tmpdir(), "a11y-guard-"));

export default defineConfig({
  testDir: ".",
  testMatch: /a11y-guard\.spec\.ts$/,
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"]] : "list",
  use: {
    baseURL: externalBaseUrl || `http://localhost:${port}`,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: externalBaseUrl ? undefined : {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    cwd: process.cwd(),
    timeout: 120_000,
    env: {
      DEV_MOCK_JMAP: "true",
      JMAP_SERVER_URL: `http://localhost:${port}/api/dev-jmap`,
      SESSION_SECRET: "a11y-guard-session-secret-0123456789abcdef",
      ADMIN_CONFIG_DIR: join(adminDir, "config"),
      ADMIN_STATE_DIR: join(adminDir, "state"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
