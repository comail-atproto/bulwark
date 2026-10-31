import { describe, it, expect } from 'vitest';
import { BUILTIN_THEMES } from '../builtin-themes';

// Issue #1765 (items 2 + 3), refreshed audit 2026-07-02.
//
// Item 3 — Dark-mode sidebar renders the LIGHT teal. The comail skin paints the
// task rail (`.w-14.bg-secondary`) and the folder sidebar (`.bg-secondary.border-r`)
// with the deep-teal literals (#02413c slab, #1a5466 selected/hover slab). Those
// paints are UNSCOPED, so in dark mode the sidebar keeps the light teal instead
// of deferring to the dark tokens (--color-sidebar #16181d). The fix adds
// `.dark`-scoped overrides that repaint those surfaces back to the dark tokens.
//
// Item 2 — Folder counts on the SELECTED/hover slab. The count text carries
// `.text-muted-foreground` which the skin remaps to #a8b3a0. That is 5.27:1 on
// the resting teal (#02413c) but only 3.84:1 on the brighter selected slab
// (#1a5466). The fix lifts muted-foreground to the cream #ecefcf (7.1:1) when it
// sits on the selected/hover slab.
//
// Guardrails: light theme untouched; no NEW brand hexes (all values already live
// in builtin-themes.ts); the #1762 guard (no .dark sidebar text-foreground /
// text-primary remap) must stay green — these overrides target BACKGROUND paints
// and the muted-foreground count, never .text-foreground / .text-primary.

const DARK_SIDEBAR = '#16181d'; // --color-sidebar (dark)
const LIGHT_TEAL = '#02413c'; // resting deep-teal (light only)
const LIGHT_SLAB = '#1a5466'; // selected/hover slab (light only)
const CREAM = '#ecefcf'; // accessible cream fg (7.1:1 on #1a5466)
const LOW_CONTRAST_COUNT = '#a8b3a0'; // 3.84:1 on #1a5466 — must not remain on the slab

function comailSkin(): string {
  const theme = BUILTIN_THEMES.find((t) => t.id === 'builtin-comail');
  expect(theme, 'builtin-comail theme must exist').toBeTruthy();
  expect(theme!.skin, 'builtin-comail must ship a skin').toBeTruthy();
  return theme!.skin as string;
}

function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.push({ selector: m[1].trim(), body: m[2].trim() });
  }
  return out;
}

function targetsSidebar(selector: string): boolean {
  return selector
    .split(',')
    .some((s) => /\.bg-secondary\.border-r|\.w-14\.bg-secondary/.test(s));
}

const isDark = (selector: string) => /(^|\s|,)\.dark\b/.test(selector);

describe('comail skin — dark sidebar defers to dark tokens (#1765 item 3)', () => {
  it('adds a .dark-scoped repaint of the teal sidebar surface to the dark sidebar token', () => {
    const blocks = rules(comailSkin());
    const darkSidebar = blocks.filter(
      (b) => isDark(b.selector) && targetsSidebar(b.selector),
    );
    expect(
      darkSidebar.length,
      'a .dark rule must override the teal sidebar paint so dark mode does not show the light teal',
    ).toBeGreaterThan(0);
    const paints = darkSidebar.map((b) => b.body.toLowerCase()).join('\n');
    // The dark surface must resolve to the dark sidebar neutral, not the teal.
    expect(paints).toContain(DARK_SIDEBAR.toLowerCase());
    expect(paints).not.toContain(LIGHT_TEAL.toLowerCase());
    expect(paints).not.toContain(LIGHT_SLAB.toLowerCase());
  });

  it('does NOT introduce a new .dark sidebar text-foreground/text-primary remap (#1762 guard)', () => {
    const blocks = rules(comailSkin());
    const darkFg = blocks.filter(
      (b) =>
        isDark(b.selector) &&
        targetsSidebar(b.selector) &&
        /\.text-foreground\b|\.text-primary\b/.test(b.selector),
    );
    expect(
      darkFg,
      'dark sidebar fg must stay governed by tokens, not new .text-foreground/.text-primary skin rules',
    ).toHaveLength(0);
  });

  it('leaves the light teal paints intact (light theme untouched)', () => {
    const blocks = rules(comailSkin());
    const lightTeal = blocks.filter(
      (b) =>
        !isDark(b.selector) &&
        targetsSidebar(b.selector) &&
        b.body.toLowerCase().includes(LIGHT_TEAL.toLowerCase()),
    );
    expect(
      lightTeal.length,
      'the light-mode deep-teal sidebar paint must remain',
    ).toBeGreaterThan(0);
  });
});

describe('comail skin — folder counts on the selected slab (#1765 item 2)', () => {
  it('lifts .text-muted-foreground on the selected/hover slab to the cream fg', () => {
    const blocks = rules(comailSkin());
    // A light-mode sidebar rule that targets the selected/hover slab
    // (.border-l-2.border-primary / .hover:bg-muted) AND remaps muted-foreground.
    const slabCount = blocks.filter(
      (b) =>
        !isDark(b.selector) &&
        targetsSidebar(b.selector) &&
        /\.text-muted-foreground\b/.test(b.selector) &&
        /border-primary|border-l-2|hover\\?:bg-muted|selected|\.bg-primary\\?\/10/.test(
          b.selector,
        ),
    );
    expect(
      slabCount.length,
      'the count text on the selected/hover slab must be remapped off #a8b3a0 (3.84:1 on #1a5466)',
    ).toBeGreaterThan(0);
    const paints = slabCount.map((b) => b.body.toLowerCase()).join('\n');
    expect(paints).toContain(CREAM.toLowerCase());
    expect(paints).not.toContain(LOW_CONTRAST_COUNT.toLowerCase());
  });
});
