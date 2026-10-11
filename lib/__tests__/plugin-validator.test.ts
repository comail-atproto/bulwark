import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractTheme, extractPlugin } from '../plugin-validator';

function createZipFile(zip: JSZip, name = 'test.zip'): Promise<File> {
  return zip.generateAsync({ type: 'blob' }).then(blob => new File([blob], name));
}

describe('extractTheme', () => {
  it('extracts a valid theme ZIP', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'my-theme',
      name: 'My Theme',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light', 'dark'],
    }));
    zip.file('theme.css', ':root { --color-primary: #ff0000; }\n.dark { --color-primary: #00ff00; }');

    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.manifest!.id).toBe('my-theme');
    expect(result.css).toContain('--color-primary');
  });

  it('rejects oversized theme', async () => {
    // Theme size limit is 2 MB; create a file just past it.
    const oversizedFile = new File([new ArrayBuffer(2 * 1024 * 1024 + 1)], 'big.zip');
    const result = await extractTheme(oversizedFile);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Theme ZIP exceeds 2 MB size limit');
  });

  it('rejects non-ZIP file', async () => {
    const file = new File(['not a zip'], 'bad.zip');
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid ZIP file');
  });

  it('rejects missing manifest.json', async () => {
    const zip = new JSZip();
    zip.file('theme.css', ':root { --color-primary: blue; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing manifest.json');
  });

  it('rejects invalid JSON manifest', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', 'not json {{{');
    zip.file('theme.css', ':root { --color-primary: blue; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid manifest.json (not valid JSON)');
  });

  it('rejects missing theme.css', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'no-css',
      name: 'No CSS',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light'],
    }));
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing theme.css');
  });

  it('rejects wrong type in manifest', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'wrong-type',
      name: 'Wrong',
      version: '1.0.0',
      author: 'Test',
      type: 'plugin', // wrong
      variants: ['light'],
    }));
    zip.file('theme.css', ':root { --color-primary: blue; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Expected type "theme"'))).toBe(true);
  });

  it('rejects missing variants', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'no-variants',
      name: 'No Variants',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
    }));
    zip.file('theme.css', ':root { --color-primary: blue; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('variants'))).toBe(true);
  });

  it('handles ZIP with folder root', async () => {
    const zip = new JSZip();
    const folder = zip.folder('my-theme')!;
    folder.file('manifest.json', JSON.stringify({
      id: 'nested-theme',
      name: 'Nested',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light', 'dark'],
    }));
    folder.file('theme.css', ':root { --color-primary: #aaa; }\n.dark { --color-primary: #bbb; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.manifest!.id).toBe('nested-theme');
  });

  // ── Theme API v2 (advanced manifest) ──────────────────────────────

  it('compiles a v2 manifest with tokens and no theme.css', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'tokens-only',
      name: 'Tokens Only',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light', 'dark'],
      apiVersion: 2,
      tokens: {
        light: { primary: '#1373d9', background: '#ffffff' },
        dark: { primary: '#58c9ff', background: '#1a202c' },
      },
    }));
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.css).toContain('--color-primary: #1373d9');
    expect(result.css).toContain('--color-primary: #58c9ff');
  });

  it('concatenates compiled tokens with author-supplied theme.css', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'tokens-plus-css',
      name: 'Tokens + CSS',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light'],
      apiVersion: 2,
      tokens: { light: { primary: '#000' } },
    }));
    zip.file('theme.css', '@font-face { font-family: "X"; src: local("X"); }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.css).toContain('--color-primary: #000');
    expect(result.css).toContain('@font-face');
  });

  it('extracts a skin.css when shipped with a v2 manifest', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'with-skin',
      name: 'With Skin',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light'],
      apiVersion: 2,
      tokens: { light: { primary: '#000' } },
    }));
    zip.file('skin.css', '[data-tour="email-list"] { font-size: 13px; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.skin).not.toBeNull();
    expect(result.skin!).toContain('[data-tour="email-list"]');
  });

  it('strips dangerous patterns from skin.css', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'evil-skin',
      name: 'Evil',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light'],
      apiVersion: 2,
      tokens: { light: { primary: '#000' } },
    }));
    zip.file('skin.css', '@import url("https://x.com/p.css"); button { background: javascript:alert(1); }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.skin).not.toBeNull();
    expect(result.skin!).not.toContain('javascript:');
    expect(result.skin!).not.toContain('@import');
    expect(result.warnings.some((w) => w.toLowerCase().includes('skin'))).toBe(true);
  });

  it('ignores skin.css when manifest is not v2', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'v1-with-skin',
      name: 'V1',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light'],
    }));
    zip.file('theme.css', ':root { --color-primary: #000; }');
    zip.file('skin.css', 'body { display: none; }');
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(true);
    expect(result.skin).toBeNull();
    expect(result.warnings.some((w) => w.includes('skin.css ignored'))).toBe(true);
  });

  it('rejects a v2 manifest with invalid density', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'bad-density',
      name: 'Bad',
      version: '1.0.0',
      author: 'Test',
      type: 'theme',
      variants: ['light'],
      density: 'gigantic',
      tokens: { light: { primary: '#000' } },
    }));
    const file = await createZipFile(zip);
    const result = await extractTheme(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('density'))).toBe(true);
  });
});

describe('extractPlugin', () => {
  it('extracts a valid plugin ZIP', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      author: 'Test',
      type: 'ui-extension',
      entrypoint: 'index.js',
      permissions: ['email:read'],
    }));
    zip.file('index.js', 'export function activate(api) { console.log("hi"); }');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(true);
    expect(result.manifest!.id).toBe('my-plugin');
    expect(result.code).toContain('activate');
  });

  it('rejects oversized plugin', async () => {
    const oversizedFile = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], 'big.zip');
    const result = await extractPlugin(oversizedFile);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plugin ZIP exceeds 5 MB size limit');
  });

  it('rejects non-ZIP file', async () => {
    const file = new File(['not a zip'], 'bad.zip');
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid ZIP file');
  });

  it('rejects missing manifest', async () => {
    const zip = new JSZip();
    zip.file('index.js', 'export function activate() {}');
    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing manifest.json');
  });

  it('rejects disallowed file types', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'bad-files',
      name: 'Bad',
      version: '1.0.0',
      author: 'Test',
      type: 'hook',
      entrypoint: 'index.js',
      permissions: [],
    }));
    zip.file('index.js', 'export function activate() {}');
    zip.file('hack.exe', 'binary');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('.exe'))).toBe(true);
  });

  it('rejects unknown permissions', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'bad-perms',
      name: 'Bad perms',
      version: '1.0.0',
      author: 'Test',
      type: 'hook',
      entrypoint: 'index.js',
      permissions: ['email:read', 'nuclear:launch'],
    }));
    zip.file('index.js', 'export function activate() {}');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('nuclear:launch'))).toBe(true);
  });

  it('warns about eval() in code', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'eval-plugin',
      name: 'Eval',
      version: '1.0.0',
      author: 'Test',
      type: 'hook',
      entrypoint: 'index.js',
      permissions: [],
    }));
    zip.file('index.js', 'export function activate() { eval("alert(1)"); }');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('eval()'))).toBe(true);
  });

  it('warns about document.cookie in code', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'cookie-plugin',
      name: 'Cookie',
      version: '1.0.0',
      author: 'Test',
      type: 'hook',
      entrypoint: 'index.js',
      permissions: [],
    }));
    zip.file('index.js', 'export function activate() { const c = document.cookie; }');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('document.cookie'))).toBe(true);
  });

  it('rejects invalid plugin type', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'bad-type',
      name: 'Bad Type',
      version: '1.0.0',
      author: 'Test',
      type: 'theme', // wrong type for plugin
      entrypoint: 'index.js',
      permissions: [],
    }));
    zip.file('index.js', 'export function activate() {}');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid type'))).toBe(true);
  });

  it('rejects missing entrypoint', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'no-entry',
      name: 'No Entry',
      version: '1.0.0',
      author: 'Test',
      type: 'hook',
      entrypoint: 'main.js',
      permissions: [],
    }));
    zip.file('index.js', 'export function activate() {}');
    // entrypoint 'main.js' doesn't exist

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing entrypoint'))).toBe(true);
  });

  it('rejects invalid manifest ID format', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'Bad_ID!',
      name: 'Bad ID',
      version: '1.0.0',
      author: 'Test',
      type: 'hook',
      entrypoint: 'index.js',
      permissions: [],
    }));
    zip.file('index.js', 'export function activate() {}');

    const file = await createZipFile(zip);
    const result = await extractPlugin(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ID must be lowercase'))).toBe(true);
  });
});
