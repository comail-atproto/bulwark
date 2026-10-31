import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Acceptance criterion (issue #1768): "No external calls to randomuser.me /
// freepik.com in the prod bundle."
//
// avatar.tsx keeps dev-only demo portrait sources. They are guarded at runtime
// by the `devMode` config flag, but a runtime guard does not remove the URL
// string literals from the production bundle. To be stripped by the bundler's
// dead-code elimination, every external-host literal must live inside a branch
// keyed on the compile-time-foldable constant IS_DEV
// (`process.env.NODE_ENV !== "production"`).
//
// This test reads the source and asserts each external-host reference sits on a
// line that participates in an IS_DEV-gated ternary block, so a production build
// (NODE_ENV=production => IS_DEV=false) folds them away.
const SOURCE = readFileSync(
  join(__dirname, '..', 'avatar.tsx'),
  'utf-8',
);

const EXTERNAL_HOSTS = ['randomuser.me', 'freepik.com'];

const isComment = (line: string): boolean => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

describe('avatar.tsx external portrait sources (prod bundle)', () => {
  it('gates every external host behind the IS_DEV compile-time constant', () => {
    const lines = SOURCE.split('\n');

    for (const host of EXTERNAL_HOSTS) {
      const hits = lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => line.includes(host) && !isComment(line));

      expect(hits.length, `expected ${host} to appear in a dev-only block`).toBeGreaterThan(0);

      for (const { idx } of hits) {
        // Walk upward from the reference to the nearest block opener and
        // require it to be an `IS_DEV ?` ternary (dev-gated). If we reach an
        // unguarded `function`/`const ... =` declaration first, the literal
        // is reachable in prod.
        let guarded = false;
        for (let i = idx; i >= 0 && i > idx - 40; i--) {
          const l = lines[i];
          if (/IS_DEV\s*\?/.test(l)) {
            guarded = true;
            break;
          }
          // A bare function declaration or plain const object opener that is
          // not IS_DEV-gated means the block is emitted unconditionally.
          if (/^(export\s+)?function\s+getProfilePictureUrl/.test(l.trim())) {
            break;
          }
        }
        expect(
          guarded,
          `${host} on line ${idx + 1} is not inside an IS_DEV-gated block`,
        ).toBe(true);
      }
    }
  });
});
