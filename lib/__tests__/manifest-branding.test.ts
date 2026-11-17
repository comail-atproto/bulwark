import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  configureLogger: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { headers } from 'next/headers';
import { configManager } from '@/lib/admin/config-manager';
import manifest from '@/app/manifest';

const directory = mkdtempSync(join(tmpdir(), 'bulwark-manifest-'));

beforeEach(async () => {
  vi.stubEnv('ADMIN_CONFIG_DIR', directory);
  rmSync(join(directory, 'config.json'), { force: true });
  for (const key of ['APP_NAME', 'APP_SHORT_NAME', 'NEXT_PUBLIC_APP_NAME', 'PWA_THEME_COLOR', 'PWA_BACKGROUND_COLOR', 'DOMAIN_BRANDING']) {
    vi.stubEnv(key, undefined);
  }
  vi.mocked(headers).mockResolvedValue(new Headers({ host: 'mail.example.com' }) as Awaited<ReturnType<typeof headers>>);
  await configManager.reload();
});

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('PWA branding configuration', () => {
  it('retains stock upstream defaults without deployment branding', async () => {
    expect(await manifest()).toMatchObject({
      name: 'Bulwark Webmail',
      theme_color: '#ffffff',
      background_color: '#ffffff',
    });
  });

  it('keeps Comail branding through the existing runtime settings', async () => {
    vi.stubEnv('APP_NAME', 'Comail');
    vi.stubEnv('PWA_THEME_COLOR', '#02413c');
    vi.stubEnv('PWA_BACKGROUND_COLOR', '#dfe0c0');
    expect(await manifest()).toMatchObject({
      name: 'Comail',
      short_name: 'Comail',
      theme_color: '#02413c',
      background_color: '#dfe0c0',
    });
  });

  it('lets the selected domain override the deployment branding', async () => {
    vi.stubEnv('APP_NAME', 'Comail');
    vi.stubEnv('PWA_THEME_COLOR', '#02413c');
    vi.stubEnv('PWA_BACKGROUND_COLOR', '#dfe0c0');
    vi.stubEnv('DOMAIN_BRANDING', JSON.stringify([{ host: 'mail.example.com', appName: 'Example Mail', pwaThemeColor: '#123456', pwaBackgroundColor: '#abcdef' }]));
    expect(await manifest()).toMatchObject({
      name: 'Example Mail',
      theme_color: '#123456',
      background_color: '#abcdef',
    });
  });

  it('lets admin settings override the deployment branding', async () => {
    vi.stubEnv('APP_NAME', 'Comail');
    vi.stubEnv('PWA_THEME_COLOR', '#02413c');
    vi.stubEnv('PWA_BACKGROUND_COLOR', '#dfe0c0');
    writeFileSync(join(directory, 'config.json'), JSON.stringify({
      appName: 'Example Mail', pwaThemeColor: '#123456', pwaBackgroundColor: '#abcdef',
    }));
    await configManager.reload();
    expect(await manifest()).toMatchObject({
      name: 'Example Mail',
      theme_color: '#123456',
      background_color: '#abcdef',
    });
  });
});
