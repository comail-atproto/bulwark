// @vitest-environment node
import { build } from 'esbuild';
import { loadBindings, minify } from 'next/dist/build/swc';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('production avatar bundle', () => {
  it('excludes external demo portrait hosts from emitted code', async () => {
    const result = await build({
      entryPoints: [join(process.cwd(), 'components/ui/avatar.tsx')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      packages: 'external',
      alias: { '@': process.cwd() },
      define: { 'process.env.NODE_ENV': '"production"' },
      minify: true,
    });
    await loadBindings();
    const { code } = await minify(result.outputFiles.map(file => file.text).join('\n'), {
      compress: true, mangle: true, module: true,
    });
    expect(code).toMatch(/export\s*\{/);
    for (const host of ['randomuser.me', 'freepik.com']) {
      expect(code).not.toContain(host);
    }
  });
});
