import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Issue #1765 (item 1): the unread-count badge on the navigation rail painted
// `#ffffff` on Tailwind red-500 (`#fb2c36`) at 10px bold = 3.8:1 — below the
// WCAG AA 4.5:1 text minimum, and it does so in BOTH light and dark because
// `bg-red-500` is a hardcoded utility, not a theme token. The fix routes the
// badge through the theme's destructive token (comail light destructive
// `#b23b30` = 6.0:1 with white; dark `#e0675a` on its ink foreground passes),
// so every skin gets an accessible badge for free.
//
// We assert against the component SOURCE (same string-assertion approach the
// theme/skin suites use) rather than rendering the rail, which would require
// mocking next-intl, routing, and several stores.

const here = dirname(fileURLToPath(import.meta.url));
const railSource = readFileSync(
  resolve(here, '..', 'navigation-rail.tsx'),
  'utf8',
);

// Grab every className string that also mentions a rounded-full badge pill so
// we reason only about the count-badge spans, not unrelated utilities.
function badgeClassLists(src: string): string[] {
  const out: string[] = [];
  const re = /className=\{?(?:cn\()?\s*"([^"]*rounded-full[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // A count badge carries the tiny bold text sizing used for the number.
    if (/text-\[10px\]/.test(m[1]) && /font-bold/.test(m[1])) out.push(m[1]);
  }
  return out;
}

describe('navigation-rail unread badge contrast (#1765)', () => {
  it('has at least the two count-badge pills (rail + collapsed sidebar)', () => {
    const badges = badgeClassLists(railSource);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('no badge pill uses the hardcoded red-500 fill or white ink', () => {
    for (const cls of badgeClassLists(railSource)) {
      expect(cls, `badge must not hardcode red-500: ${cls}`).not.toMatch(/\bbg-red-500\b/);
      expect(cls, `badge must not hardcode text-white: ${cls}`).not.toMatch(/\btext-white\b/);
    }
  });

  it('every badge pill routes through the destructive theme token', () => {
    const badges = badgeClassLists(railSource);
    for (const cls of badges) {
      expect(cls, `badge must use bg-destructive: ${cls}`).toMatch(/\bbg-destructive\b/);
      expect(cls, `badge must use text-destructive-foreground: ${cls}`).toMatch(
        /\btext-destructive-foreground\b/,
      );
    }
  });
});
