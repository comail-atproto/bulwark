import { defineConfig } from '@playwright/test';
import upstream from './playwright.integration.config';

export default defineConfig({
  ...upstream,
  failOnFlakyTests: !!process.env.CI,
  ...(process.env.IT_SUITE === 'smoke' ? {
    // A renamed or missing native spec must fail configuration, not shrink coverage.
    testMatch: [
      require.resolve('./integration/tests/01-login.spec.ts'),
      require.resolve('./integration/tests/02-mail-sync.spec.ts'),
      require.resolve('./integration/tests/15-server-session.spec.ts'),
    ],
  } : {}),
});
