import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Issue #1765 (item 4): axe reported no <main> landmark and no <h1> on the
// inbox shell (33 region violations), and the login shell had no <main>
// landmark. Screen-reader users get no "skip to main" target and the page
// exposes no top-level heading.
//
// The inbox page is a ~3k-line client component wired to many stores/routers;
// the login page has several early returns. Rendering either in jsdom to run
// axe is impractical here, so we assert the landmark/heading MARKUP exists in
// source — the same static-source approach the skin/theme suites use. The
// rendered-DOM axe pass remains CI's job on a real build.

const here = dirname(fileURLToPath(import.meta.url));
const inboxSource = readFileSync(
  resolve(here, '..', '..', '..', '..', 'components', 'mail', 'mail-app.tsx'),
  'utf8',
);
const loginSource = readFileSync(resolve(here, '..', 'login', 'page.tsx'), 'utf8');

describe('inbox shell landmarks (#1765 item 4)', () => {
  it('renders a <main> landmark for the message-list/viewer area', () => {
    expect(
      /<main[\s>]/.test(inboxSource),
      'the inbox content area must be a <main> landmark',
    ).toBe(true);
  });

  it('exposes exactly one h1 (an sr-only page heading is acceptable)', () => {
    const opens = inboxSource.match(/<h1[\s>]/g) ?? [];
    expect(opens.length, 'inbox must have exactly one <h1>').toBe(1);
  });
});

describe('login shell landmarks (#1765 item 4)', () => {
  it('renders a <main> landmark around the login card', () => {
    expect(
      /<main[\s>]/.test(loginSource),
      'the login card must sit inside a <main> landmark',
    ).toBe(true);
  });

  it('still exposes an h1 (the app-name heading) and never a bare h3 before it', () => {
    const h1 = loginSource.indexOf('<h1');
    expect(h1, 'login must keep its <h1>').toBeGreaterThan(-1);
    const h3 = loginSource.indexOf('<h3');
    // Either there is no h3 at all, or it does not precede the h1 (valid order).
    expect(h3 === -1 || h3 > h1, 'no h3 may precede the login h1').toBe(true);
  });
});
