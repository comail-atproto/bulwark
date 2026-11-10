import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractTheme } from '@/lib/plugin-validator';

const packagePath = 'public/branding/comail/builtin-comail-1.0.1.zip';

describe('packaged Comail theme', () => {
  it('loads its light/dark colors and component skin through the upstream validator', async () => {
    const bytes = readFileSync(packagePath);
    const result = await extractTheme(new File([bytes], 'comail.zip') as unknown as globalThis.File);
    expect(result.valid, result.errors.join('; ')).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.manifest).toMatchObject({ id: 'builtin-comail', apiVersion: 2, variants: ['light', 'dark'] });
    expect(result.css).toContain('--color-background: #dfe0c0;');
    expect(result.css).toContain('--color-background: #1c1f24;');
    expect(result.skin).toContain('body[data-theme-skin="builtin-comail"]');
  });

  it('ships the maintained manifest, colors and skin without unrelated files', async () => {
    const zip = await JSZip.loadAsync(readFileSync(packagePath), { checkCRC32: true });
    expect(Object.keys(zip.files).sort()).toEqual(['LICENSE', 'manifest.json', 'skin.css', 'theme.css']);
    expect(await zip.file('LICENSE')!.async('string')).toBe(readFileSync('LICENSE', 'utf8'));
    for (const name of ['manifest.json', 'skin.css', 'theme.css']) {
      expect(await zip.file(name)!.async('string')).toBe(readFileSync(`themes/comail/${name}`, 'utf8'));
    }
  });
});
