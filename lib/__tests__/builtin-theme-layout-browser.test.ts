import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from '@/lib/builtin-themes';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

describe.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('built-in themes with logical sidebar classes', () => {
  let compatibility: string;
  beforeAll(async () => {
    const input = readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
    compatibility = (await postcss([tailwindcss()]).process(input, { from: 'app/globals.css' })).css;
  });

  it.each(['builtin-roundcube-elastic', 'builtin-aurora-glass'])('preserves %s sidebar and unread styles in both directions and palettes', async (id) => {
    const theme = BUILTIN_THEMES.find(theme => theme.id === id)!;
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH });
    try {
      const page = await browser.newPage();
      for (const direction of ['ltr', 'rtl']) {
        for (const dark of [false, true]) {
          await page.setContent(`<html dir="${direction}" class="${dark ? 'dark' : ''}"><style>${theme.css}\n${theme.skin}\n${compatibility}</style>
            <body data-theme-skin="${id}">
              ${['legacy', 'logical'].map((kind) => `<aside id="${kind}" class="bg-secondary ${kind === 'legacy' ? 'border-r' : 'border-e'}">
                <span class="${kind === 'legacy' ? 'ml-2' : 'ms-2'} flex-shrink-0 gap-1 items-baseline"><span class="font-semibold">3</span><span class="text-muted-foreground">10</span></span>
                <span class="${kind === 'legacy' ? 'ml-2' : 'ms-2'} flex-shrink-0 gap-1 items-baseline"><span class="text-muted-foreground">10</span></span>
                <button class="${kind === 'legacy' ? 'border-l-2' : 'border-s-2'} border-primary">Inbox</button>
              </aside>`).join('')}
            </body></html>`);
          const styles = async (selector: string) => page.locator(selector).evaluate(el => [el, ...el.querySelectorAll('*')].map(node => {
            const style = getComputedStyle(node);
            return [style.backgroundColor, style.color, style.display, style.borderLeftWidth, style.backdropFilter];
          }));
          expect(await styles('#logical')).toEqual(await styles('#legacy'));
          await page.evaluate(() => document.body.removeAttribute('data-theme-skin'));
          expect(await styles('#logical')).toEqual(await styles('#legacy'));
        }
      }
    } finally {
      await browser.close();
    }
  });
});
