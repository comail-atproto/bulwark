/**
 * Text sizes in rem follow both the browser's text size and Settings >
 * Accessibility > Text size (WCAG 1.4.4); a `text-[10px]` follows neither.
 * The message list rows are left out: they are being rewritten separately.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SKIP = new Set([
  path.join('components', 'email', 'thread-list-item.tsx'),
  path.join('components', 'email', 'email-list.tsx'),
]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (name === '__tests__' || name === 'node_modules' || rel === path.join('app', 'api')) continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) sources(rel, out);
    else if (/\.(tsx|ts)$/.test(name) && !SKIP.has(rel)) out.push(rel);
  }
  return out;
}

describe('text sizes', () => {
  it('uses no pixel text sizes or line heights in the UI', () => {
    const offenders: string[] = [];
    for (const file of [...sources('components'), ...sources('app'), ...sources('lib'), ...sources('hooks')]) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const m of text.matchAll(/(?<![\w-])(?:text|leading)-\[\d+(?:\.\d+)?px\]/g)) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
