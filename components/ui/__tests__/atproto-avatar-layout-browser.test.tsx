import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Avatar } from '../avatar';
import { AtprotoAvatar } from '../atproto-avatar';
import { COMAIL_THEME } from '@/lib/__tests__/fixtures/comail-theme';

describe.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('composed account avatar layout', () => {
  let stylesheet: string;
  let browser: Browser;
  beforeAll(async () => {
    const input = readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";',
      '@import "tailwindcss" source(none);\n@source "../components/ui/avatar.tsx";');
    stylesheet = (await postcss([tailwindcss()]).process(input, { from: 'app/globals.css' })).css;
    browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH });
  });
  afterAll(async () => { await browser?.close(); });

  it.each([false, true])('retains native sizes, colors and alignment (dark=%s)', async (dark) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const rows = (['sm', 'md', 'lg'] as const).map(size => {
        const props = { name: 'Example Member', size, disableFavicon: true };
        return `<section style="display:flex;gap:32px;align-items:center">
          <button id="native-${size}">${renderToStaticMarkup(createElement(Avatar, props))}</button>
          <button id="comail-${size}">${renderToStaticMarkup(createElement(AtprotoAvatar, { ...props, did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }))}</button>
        </section>`;
      }).join('');
      await page.setContent(`<html class="${dark ? 'dark' : ''}"><style>${stylesheet}\n${COMAIL_THEME.css}\n${COMAIL_THEME.skin}</style>
        <body data-theme-skin="builtin-comail">${rows}</body></html>`);
      for (const size of ['sm', 'md', 'lg']) {
        const metrics = (id: string) => page.locator(`#${id} [title="Example Member"]`).evaluate(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return [rect.width, rect.height, rect.top, style.color, style.backgroundColor, style.borderRadius, style.overflow];
        });
        expect(await metrics(`comail-${size}`)).toEqual(await metrics(`native-${size}`));
      }
    } finally {
      await context.close();
    }
  });
});
