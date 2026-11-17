import { defineConfig } from '@playwright/test';

if (!process.env.PLUGIN_BROWSER_BASE_URL) throw new Error('Set PLUGIN_BROWSER_BASE_URL to the isolated production server');
export default defineConfig({
  testDir: '../..',
  testMatch: /plugin-security-browser\.pw\.ts$/,
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLUGIN_BROWSER_BASE_URL,
    browserName: 'chromium',
    launchOptions: process.env.COMAIL_CHROMIUM_PATH ? { executablePath: process.env.COMAIL_CHROMIUM_PATH } : undefined,
  },
});
