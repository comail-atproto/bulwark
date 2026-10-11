import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from '@/lib/builtin-themes';

const theme = BUILTIN_THEMES.find((item) => item.id === 'builtin-comail')!;
const globals = readFileSync('app/globals.css', 'utf8');
const scrollbarCss = globals.slice(globals.indexOf('/* Minimalist scrollbar */'), globals.indexOf('/* Enhanced Email Content Styling */'));

describe.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('Comail theme in the browser', () => {
  it('keeps selected settings readable and colors native scrollbars from the theme', async () => {
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH });
    try {
      const page = await browser.newPage({ viewport: { width: 790, height: 620 } });
      await page.setContent(`<style>${theme.css}\n${theme.skin}\n${scrollbarCss}
        body{margin:0;background:var(--color-background)} aside{width:280px;padding:16px;height:580px}
        button{display:block;width:100%;padding:12px;text-align:left;border:0;border-radius:8px;background:transparent}
        .bg-secondary{background:var(--color-secondary)} .bg-accent{background:var(--color-accent)}
        .text-accent-foreground{color:var(--color-accent-foreground)}
        .scroll-pane{position:absolute;left:312px;top:20px;width:350px;height:560px;overflow-y:scroll}
      </style><body data-theme-skin="builtin-comail"><aside class="bg-secondary border-e">
        <button id="selected" class="bg-accent text-accent-foreground">Account</button><button id="resting">Appearance</button>
      </aside><div id="scroll" class="scroll-pane">${'<p>Synthetic mailbox message</p>'.repeat(80)}</div></body>`);
      if (process.env.COMAIL_THEME_EVIDENCE) {
        await page.screenshot({ path: process.env.COMAIL_THEME_EVIDENCE });
      }
      expect(await page.locator('#selected').evaluate(el => getComputedStyle(el).color)).toBe('rgb(2, 65, 60)');
      expect(await page.locator('#resting').evaluate(el => getComputedStyle(el).color)).toBe('rgb(236, 239, 207)');
      expect(await page.locator('#scroll').evaluate(el => getComputedStyle(el).scrollbarColor)).toBe('rgb(74, 84, 78) rgba(0, 0, 0, 0)');
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      expect(await page.locator('#selected').evaluate(el => getComputedStyle(el).color)).toBe('rgb(109, 191, 214)');
      expect(await page.locator('#scroll').evaluate(el => getComputedStyle(el).scrollbarColor)).toBe('rgb(168, 172, 177) rgba(0, 0, 0, 0)');
    } finally {
      await browser.close();
    }
  });
});
