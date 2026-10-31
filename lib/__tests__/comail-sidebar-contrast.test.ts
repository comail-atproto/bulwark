import { describe, it, expect } from 'vitest';
import { BUILTIN_THEMES } from '../builtin-themes';

// Regression coverage for issue #1762: in LIGHT mode the comail folder
// sidebar (deep-teal #02413c) leaked the surface ink #012102 onto its own
// counts / muted text / account header / "Demo Mode" banner because the skin
// only remapped `.text-muted-foreground` — not `.text-foreground` or
// `.text-primary` — inside the sidebar. Those tokens must resolve to the cream
// sidebar foreground so text clears WCAG AA (4.5:1) against the teal.
//
// We assert against the compiled skin CSS string (same approach as
// builtin-themes.test.ts). The teal sidebar surface is targeted in the skin by
// the `.bg-secondary.border-r` selector and the narrow rail by `.w-14.bg-secondary`.

const CREAM = '#ecefcf'; // established comail sidebar-foreground (9.77:1 on #02413c)
const INK = '#012102'; // darkestBlue surface ink — must NOT be the fg on teal

function comailSkin(): string {
  const theme = BUILTIN_THEMES.find(t => t.id === 'builtin-comail');
  expect(theme, 'builtin-comail theme must exist').toBeTruthy();
  expect(theme!.skin, 'builtin-comail must ship a skin').toBeTruthy();
  return theme!.skin as string;
}

// Split the skin into individual rule blocks ("selector { body }") so we can
// reason about a selector and its declarations together.
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.push({ selector: m[1].trim(), body: m[2].trim() });
  }
  return out;
}

// A rule targets the teal sidebar surface if any of its comma-separated
// selectors mention the folder sidebar (.bg-secondary.border-r) or the narrow
// task rail (.w-14.bg-secondary).
function targetsSidebar(selector: string): boolean {
  return selector
    .split(',')
    .some(s => /\.bg-secondary\.border-r|\.w-14\.bg-secondary/.test(s));
}

const isDark = (selector: string) => /(^|\s|,)\.dark\b/.test(selector);

describe('comail skin — light sidebar foreground contrast (#1762)', () => {
  it('remaps .text-foreground on the teal sidebar to cream (not the #012102 ink)', () => {
    const blocks = rules(comailSkin());
    const match = blocks.filter(
      b => !isDark(b.selector) && targetsSidebar(b.selector) && /\.text-foreground\b/.test(b.selector),
    );
    expect(
      match.length,
      'a light-mode sidebar rule must remap .text-foreground (folder counts/labels, account header name)',
    ).toBeGreaterThan(0);
    const paints = match.map(b => b.body.toLowerCase()).join('\n');
    expect(paints).toContain(CREAM.toLowerCase());
    expect(paints).not.toContain(INK.toLowerCase());
  });

  it('remaps .text-primary on the teal sidebar to cream (fixes the "Demo Mode" banner)', () => {
    const blocks = rules(comailSkin());
    const match = blocks.filter(
      b =>
        !isDark(b.selector) &&
        targetsSidebar(b.selector) &&
        /\.text-primary\b/.test(b.selector),
    );
    expect(
      match.length,
      'a light-mode sidebar rule must remap .text-primary so the demo banner text is not #012102 on teal',
    ).toBeGreaterThan(0);
    const paints = match.map(b => b.body.toLowerCase()).join('\n');
    expect(paints).toContain(CREAM.toLowerCase());
    expect(paints).not.toContain(INK.toLowerCase());
  });

  it('keeps the existing .text-muted-foreground sidebar remap (no regression)', () => {
    const blocks = rules(comailSkin());
    const match = blocks.filter(
      b =>
        !isDark(b.selector) &&
        targetsSidebar(b.selector) &&
        /\.text-muted-foreground\b/.test(b.selector),
    );
    expect(match.length).toBeGreaterThan(0);
  });

  it('every sidebar fg remap is scoped under body[data-theme-skin="builtin-comail"]', () => {
    const blocks = rules(comailSkin());
    const fgRules = blocks.filter(
      b =>
        targetsSidebar(b.selector) &&
        /\.text-foreground\b|\.text-primary\b|\.text-muted-foreground\b/.test(b.selector),
    );
    expect(fgRules.length).toBeGreaterThan(0);
    for (const b of fgRules) {
      expect(
        b.selector.includes('body[data-theme-skin="builtin-comail"]'),
        `rule must be skin-scoped: ${b.selector}`,
      ).toBe(true);
    }
  });

  it('does not touch the dark theme: no new .dark sidebar text-foreground/text-primary remap', () => {
    const blocks = rules(comailSkin());
    const darkFg = blocks.filter(
      b =>
        isDark(b.selector) &&
        targetsSidebar(b.selector) &&
        /\.text-foreground\b|\.text-primary\b/.test(b.selector),
    );
    expect(darkFg, 'dark sidebar fg must remain governed by tokens, not new skin rules').toHaveLength(0);
  });
});
