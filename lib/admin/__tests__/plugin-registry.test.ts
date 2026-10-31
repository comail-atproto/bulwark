import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getPluginBundle, getThemeCSS } from '../plugin-registry';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bw-extension-files-'));
  vi.stubEnv('ADMIN_CONFIG_DIR', dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('extension file reads', () => {
  it.each([
    ['plugins', 'js', getPluginBundle],
    ['themes', 'css', getThemeCSS],
  ] as const)('stays inside %s directory', async (directory, extension, read) => {
    await mkdir(path.join(dir, directory));
    await writeFile(path.join(dir, `outside.${extension}`), 'outside');
    await writeFile(path.join(dir, directory, `valid-id.${extension}`), 'installed');
    expect(await read('valid-id')).toBe('installed');
    expect(await read('../outside')).toBeNull();
  });
});
