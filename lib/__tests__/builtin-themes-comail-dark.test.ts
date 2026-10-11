import { describe, it, expect } from 'vitest';
import { BUILTIN_THEMES } from '../builtin-themes';

// Guards the comail dark palette port (chainlink #675 / issue #1761).
// The docs Starlight theme reverted the darkestBlue (#012102) + sage-text
// dark palette as muddy/low-contrast; web-frontend/src/styles/starlight-comail.css
// holds the approved dark neutrals. These tests pin the comail builtin theme's
// `.dark` token block + skin to those exact values and assert the login
// regressions (ghost primary button, white handle input) can't recur.

const comail = BUILTIN_THEMES.find((t) => t.id === 'builtin-comail')!;

// Approved dark neutrals, copied verbatim from starlight-comail.css.
const DOCS_DARK = {
  background: '#1c1f24',
  sidebar: '#16181d',
  inlineCode: '#2a2d33',
  text: '#e7e9ea',
  heading: '#f1f2f3',
  accentText: '#6dbfd6',
  hairline: '#2e3138',
  hairlineLight: '#3a3d44',
  hairlineShade: '#25282e',
} as const;

// The brand cyan input surface for dark mode, per the issue spec.
const DARK_INPUT = '#053a36';

/** Extract the body of the `.dark { ... }` block from a theme's css string. */
function darkBlock(css: string): string {
  const start = css.indexOf('.dark {');
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/** Read a `--var: value;` declaration out of a CSS block. */
function tokenValue(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

describe('comail dark palette (issue #1761)', () => {
  const dark = darkBlock(comail.css);

  it('backgrounds/surfaces use the docs dark neutrals, not darkestBlue', () => {
    expect(tokenValue(dark, '--color-background')).toBe(DOCS_DARK.background);
    // No surface may reuse the reverted darkestBlue #012102 as a canvas.
    expect(tokenValue(dark, '--color-background')).not.toBe('#012102');
    expect(tokenValue(dark, '--color-sidebar')).toBe(DOCS_DARK.sidebar);
  });

  it('text + heading foregrounds are the docs off-whites', () => {
    expect(tokenValue(dark, '--color-foreground')).toBe(DOCS_DARK.text);
    // Sage paper text (#dfe0c0) was the muddy reverted choice.
    expect(tokenValue(dark, '--color-foreground')).not.toBe('#dfe0c0');
  });

  it('accent text uses the lighter cyan #6dbfd6', () => {
    expect(tokenValue(dark, '--color-accent-foreground')).toBe(DOCS_DARK.accentText);
  });

  it('borders/hairlines map to the docs hairline neutrals', () => {
    expect(tokenValue(dark, '--color-border')).toBe(DOCS_DARK.hairline);
    expect(tokenValue(dark, '--color-sidebar-border')).toBe(DOCS_DARK.hairlineLight);
  });

  it('dark input surface renders #053a36 (never white)', () => {
    // Token layer.
    expect(tokenValue(dark, '--color-input')).toBe(DARK_INPUT);
    // Skin layer: the comail skin hardcodes input colours; the dark override
    // must repaint them to #053a36 so the handle field isn't a white hole.
    expect(comail.skin).toBeTruthy();
    const skin = comail.skin!;
    const darkInputRuleIdx = skin.indexOf('.dark body[data-theme-skin="builtin-comail"] input');
    expect(darkInputRuleIdx).toBeGreaterThan(-1);
    const darkInputRule = skin.slice(darkInputRuleIdx, skin.indexOf('}', darkInputRuleIdx) + 1);
    expect(darkInputRule).toContain('#053a36');
    expect(darkInputRule).not.toContain('#ffffff');
  });

  it('dark primary button fill differs from the dark page background', () => {
    const bg = tokenValue(dark, '--color-background');
    const skin = comail.skin!;
    // Isolate the dark-mode primary-button skin rule.
    const marker = '.dark body[data-theme-skin="builtin-comail"] .bg-primary.text-primary-foreground {';
    const idx = skin.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const rule = skin.slice(idx, skin.indexOf('}', idx) + 1);
    const fill = rule.match(/background-color:\s*([^;!]+)/);
    expect(fill).not.toBeNull();
    const fillColor = fill![1].trim().toLowerCase();
    expect(fillColor).not.toBe(bg!.toLowerCase());
    // The old ghost-button value was darkestBlue #012102.
    expect(fillColor).not.toBe('#012102');
  });

  it('keeps the brand cyan accent treatment (#3fa1c0 ring, #6dbfd6 text)', () => {
    expect(tokenValue(dark, '--color-ring')).toBe('#3fa1c0');
    expect(tokenValue(dark, '--color-accent-foreground')).toBe('#6dbfd6');
  });

  it('first-paint token guard: --color-primary differs from --color-background', () => {
    // The built-in colour block IS persisted to localStorage (partialize keeps
    // css for builtIn themes) and is injected before the skin flip lands. If the
    // primary TOKEN itself equalled the background, the login button would be a
    // ghost even at first paint regardless of the skin. Pin them apart.
    const primary = tokenValue(dark, '--color-primary');
    const bg = tokenValue(dark, '--color-background');
    expect(primary).toBeTruthy();
    expect(primary!.toLowerCase()).not.toBe(bg!.toLowerCase());
  });
});

describe('comail light palette is unchanged (issue #1761 guardrail)', () => {
  it('light :root still rides sage paper with darkestBlue ink', () => {
    const root = comail.css.slice(comail.css.indexOf(':root {'), comail.css.indexOf('.dark {'));
    expect(root).toContain('--color-background: #dfe0c0;');
    expect(root).toContain('--color-foreground: #012102;');
    expect(root).toContain('--color-primary: #012102;');
    expect(root).toContain('--color-input: #ffffff;');
  });
});
