import { describe, it, expect } from 'vitest';
import { compileAdvancedTheme, isAdvancedManifest } from '../theme-compiler';
import type { ThemeManifest } from '../plugin-types';

const baseManifest = (overrides: Partial<ThemeManifest> = {}): ThemeManifest => ({
  id: 't',
  name: 'T',
  version: '1.0.0',
  author: 'tester',
  description: '',
  type: 'theme',
  variants: ['light', 'dark'],
  ...overrides,
});

describe('isAdvancedManifest', () => {
  it('returns false for plain v1 manifests', () => {
    expect(isAdvancedManifest(baseManifest())).toBe(false);
  });

  it.each([
    { apiVersion: 2 as const },
    { tokens: { light: { primary: '#000' } } },
    { extends: 'builtin-nord' },
    { derive: true },
    { density: 'compact' as const },
    { radii: { md: '6px' } },
    { typography: { fontSans: 'Inter' } },
  ])('returns true when manifest has %p', (extra) => {
    expect(isAdvancedManifest(baseManifest(extra))).toBe(true);
  });
});

describe('compileAdvancedTheme', () => {
  it('emits :root and .dark blocks from token sets', () => {
    const { css, errors } = compileAdvancedTheme(
      baseManifest({
        tokens: {
          light: { primary: '#1373d9', background: '#ffffff' },
          dark: { primary: '#58c9ff', background: '#1a202c' },
        },
      }),
    );
    expect(errors).toHaveLength(0);
    expect(css).toMatch(/:root\s*\{[\s\S]*--color-primary:\s*#1373d9/);
    expect(css).toMatch(/\.dark\s*\{[\s\S]*--color-primary:\s*#58c9ff/);
  });

  it('omits .dark block for light-only themes', () => {
    const { css } = compileAdvancedTheme(
      baseManifest({
        variants: ['light'],
        tokens: { light: { primary: '#000' }, dark: { primary: '#fff' } },
      }),
    );
    expect(css).toContain(':root');
    expect(css).not.toContain('.dark');
  });

  it('emits common tokens into both :root and .dark', () => {
    const { css } = compileAdvancedTheme(
      baseManifest({
        tokens: {
          common: { ring: '#abc' },
          light: { background: '#fff' },
          dark: { background: '#000' },
        },
      }),
    );
    const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(rootMatch).toContain('--color-ring: #abc');
    expect(darkMatch).toContain('--color-ring: #abc');
  });

  it('derives a contrasting *-foreground when derive: true', () => {
    const { css } = compileAdvancedTheme(
      baseManifest({
        derive: true,
        tokens: { light: { primary: '#000000' }, dark: { primary: '#ffffff' } },
      }),
    );
    expect(css).toMatch(/:root\s*\{[\s\S]*--color-primary-foreground:\s*#ffffff/);
    expect(css).toMatch(/\.dark\s*\{[\s\S]*--color-primary-foreground:\s*#0f172a/);
  });

  it('respects an author-provided *-foreground over derive', () => {
    const { css } = compileAdvancedTheme(
      baseManifest({
        derive: true,
        tokens: {
          light: { primary: '#000000', 'primary-foreground': '#ff00ff' },
        },
      }),
    );
    expect(css).toContain('--color-primary-foreground: #ff00ff');
  });

  it('emits radii, typography, and density vars', () => {
    const { css } = compileAdvancedTheme(
      baseManifest({
        tokens: { light: { primary: '#000' } },
        radii: { sm: '2px', md: '6px', full: '9999px' },
        typography: { fontSans: 'Inter, sans-serif', baseFontSize: '15px' },
        density: 'compact',
      }),
    );
    expect(css).toContain('--radius-sm: 2px');
    expect(css).toContain('--radius-full: 9999px');
    expect(css).toContain('--font-sans: Inter, sans-serif');
    expect(css).toContain('--font-size-base: 15px');
    expect(css).toContain('--density-row-height: 28px');
  });

  it('drops tokens with unsafe values and warns', () => {
    const { css, warnings } = compileAdvancedTheme(
      baseManifest({
        tokens: {
          light: {
            primary: '#000',
            evil: 'red; background: url("https://x.com/track.png")',
          },
        },
      }),
    );
    expect(css).toContain('--color-primary: #000');
    expect(css).not.toContain('https://x.com');
    expect(warnings.some((w) => w.includes('evil'))).toBe(true);
  });

  it('drops tokens with unsafe keys and warns', () => {
    const { css, warnings } = compileAdvancedTheme(
      baseManifest({
        tokens: { light: { 'primary }; body { background: red': '#fff', primary: '#000' } },
      }),
    );
    expect(css).toContain('--color-primary: #000');
    expect(css).not.toContain('body { background');
    expect(warnings.some((w) => w.includes('invalid key'))).toBe(true);
  });

  it('errors when no structured fields are present', () => {
    const { errors } = compileAdvancedTheme(baseManifest());
    expect(errors.length).toBeGreaterThan(0);
  });

  it('inlines parent CSS when extends + resolver supplied', () => {
    const { css, warnings } = compileAdvancedTheme(
      baseManifest({
        extends: 'parent-theme',
        tokens: { light: { primary: '#fff' } },
      }),
      { resolveExtends: (id) => (id === 'parent-theme' ? ':root { --x: 1; }' : null) },
    );
    expect(css).toContain('--x: 1');
    expect(css).toContain('--color-primary: #fff');
    expect(warnings).toHaveLength(0);
  });

  it('warns when extends parent cannot be resolved', () => {
    const { warnings } = compileAdvancedTheme(
      baseManifest({
        extends: 'missing',
        tokens: { light: { primary: '#fff' } },
      }),
      { resolveExtends: () => null },
    );
    expect(warnings.some((w) => w.includes('missing'))).toBe(true);
  });

  it('appends user-supplied CSS after compiled output', () => {
    const { css } = compileAdvancedTheme(
      baseManifest({ tokens: { light: { primary: '#fff' } } }),
      { userCSS: '@font-face { font-family: "X"; src: local("X"); }' },
    );
    const compiledIdx = css.indexOf('--color-primary');
    const userIdx = css.indexOf('@font-face');
    expect(compiledIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(compiledIdx);
  });
});
