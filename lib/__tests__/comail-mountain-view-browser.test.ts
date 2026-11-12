import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMAIL_THEME } from '@/lib/__tests__/fixtures/comail-theme';
import { AttachmentChips, ListAttachmentChips } from '@/components/email/attachment-chips';
import type { Attachment, Email } from '@/lib/jmap/types';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const theme = COMAIL_THEME;
const globals = readFileSync('app/globals.css', 'utf8');
const mountainViewCss = globals.slice(globals.indexOf('[data-interface-layout="mountain-view"] {'));

function contrast(foreground: string, background: string, canvas: string): number {
  const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
  const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const bg = channels(background);
  const under = channels(canvas);
  const alpha = bg[3] ?? 1;
  const a = luminance(channels(foreground));
  const b = luminance(bg.slice(0, 3).map((channel, index) => channel * alpha + under[index] * (1 - alpha)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('Comail Mountain View surfaces', () => {
  let stylesheet: string;
  beforeAll(async () => {
    // Generate this fixture's utilities without scanning the whole application.
    const input = globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../lib/__tests__/comail-mountain-view-browser.test.ts";');
    stylesheet = (await postcss([tailwindcss()]).process(input, { from: 'app/globals.css' })).css;
  });

  it.each(['ltr', 'rtl'])('keeps the sidebar border clear of both card corners (%s)', async (direction) => {
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent(`<html dir="${direction}" data-interface-layout="mountain-view"><style>
        ${stylesheet}\n${theme.css}\n${theme.skin}
      </style><body data-theme-skin="builtin-comail">
        <header class="h-18 px-6 flex items-center">Comail</header>
        <div class="flex h-[528px]">
          <aside id="sidebar" class="relative flex flex-col h-full border-e border-transparent bg-[var(--mv-canvas)] w-[218px] shrink-0 px-4">
            <button data-mv-compose class="p-4 rounded-2xl">Compose</button>
            <div class="mt-4">Inbox</div>
          </aside>
          <main data-mv-card class="flex-1 mb-4 me-4 p-6">Synthetic mailbox</main>
        </div>
      </body></html>`);
      if (process.env.COMAIL_MOUNTAIN_VIEW_EVIDENCE && direction === 'ltr') {
        await page.screenshot({ path: process.env.COMAIL_MOUNTAIN_VIEW_EVIDENCE });
      }
      for (const dark of [false, true]) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        expect(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).borderInlineEndColor)).toBe('rgba(0, 0, 0, 0)');
        expect(await page.locator('[data-mv-card]').evaluate(el => getComputedStyle(el).borderStartStartRadius)).toBe('16px');
        expect(await page.locator('[data-mv-card]').evaluate(el => getComputedStyle(el).overflow)).toBe('hidden');
      }
      await page.evaluate(() => {
        document.documentElement.removeAttribute('data-interface-layout');
        document.getElementById('sidebar')!.className = 'bg-secondary border-e border-border';
      });
      expect(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).borderInlineEndColor)).not.toBe('rgba(0, 0, 0, 0)');
    } finally {
      await browser.close();
    }
  });

  it.each([false, true])('uses Comail surfaces and readable message states (dark=%s)', async (dark) => {
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH });
    try {
      const page = await browser.newPage();
      const attachment: Attachment = { partId: '1', blobId: 'example-blob', name: 'invoice.pdf', type: 'application/pdf', size: 1024 };
      const chips = renderToStaticMarkup(createElement(AttachmentChips, { attachments: [attachment], onOpen: () => {} }));
      const placeholder = renderToStaticMarkup(createElement(ListAttachmentChips, {
        email: { id: 'example-message', hasAttachment: true } as Email,
        load: () => () => {},
        onOpen: () => {},
      }));
      await page.setContent(`<html class="${dark ? 'dark' : ''}" data-interface-layout="mountain-view"><head><style>
        ${theme.css}\n${mountainViewCss}\n${theme.skin}
        body{color:var(--color-foreground)}
        .flex{display:flex;align-items:center}
        .inline-flex{display:inline-flex;font:12px/16px sans-serif;border:1px solid var(--color-border);padding:2px 8px}
        .inline-flex svg{width:14px;height:14px}
        #canvas{background:var(--mv-canvas)}
        [data-mv-compose]{background:var(--mv-compose-bg);color:var(--mv-compose-fg)}
      </style></head><body data-theme-skin="builtin-comail">
        <div id="canvas"><button data-mv-compose>Compose</button></div>
        <div data-mv-nav-row data-selected="true">Inbox</div>
        <div data-mv-card><div data-mv-row>Read mail</div><div data-mv-row data-unread="true">Unread mail</div></div>
        <section id="attachments" data-mv-row>${chips}</section>
        <section id="loading" data-mv-row>${placeholder}</section>
      </body></html>`);
      const background = (selector: string) => page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor);
      expect(await background('#canvas')).toBe(dark ? 'rgb(28, 31, 36)' : 'rgb(223, 224, 192)');
      expect(await background('[data-mv-card]')).toBe(dark ? 'rgb(42, 45, 51)' : 'rgb(245, 245, 224)');
      expect(await background('[data-mv-card] [data-mv-row]:not([data-unread])')).toBe(dark ? 'rgb(28, 31, 36)' : 'rgb(223, 224, 192)');
      expect(await background('[data-unread]')).toBe(dark ? 'rgb(42, 45, 51)' : 'rgb(245, 245, 224)');
      expect(await background('[data-mv-compose]')).toBe(dark ? 'rgb(63, 161, 192)' : 'rgb(1, 33, 2)');
      expect(await page.locator('[data-mv-compose]').evaluate(el => getComputedStyle(el).color)).toBe(dark ? 'rgb(1, 33, 2)' : 'rgb(255, 255, 255)');
      for (const selector of ['[data-mv-compose]', '[data-mv-nav-row]', '[data-mv-card] [data-mv-row]:not([data-unread])', '[data-unread]']) {
        const foreground = await page.locator(selector).evaluate(el => getComputedStyle(el).color);
        expect(contrast(foreground, await background(selector), await background('#canvas')), selector).toBeGreaterThanOrEqual(4.5);
      }
      const spacing = await page.locator('#attachments > div').evaluate(el => {
        const style = getComputedStyle(el);
        return { top: style.marginTop, bottom: style.marginBottom, gap: style.gap };
      });
      expect(spacing).toEqual({ top: '8px', bottom: '8px', gap: '8px' });
      const chipHeight = await page.locator('#attachments button').evaluate(el => el.getBoundingClientRect().height);
      expect(chipHeight).toBeGreaterThanOrEqual(26);
      expect(await page.locator('#loading > div').evaluate(el => el.getBoundingClientRect().height)).toBe(
        await page.locator('#attachments > div').evaluate(el => el.getBoundingClientRect().height),
      );

      await page.evaluate(() => document.documentElement.removeAttribute('data-interface-layout'));
      expect(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--mv-canvas'))).toBe('');
      await page.evaluate(() => {
        document.documentElement.dataset.interfaceLayout = 'mountain-view';
        document.body.removeAttribute('data-theme-skin');
      });
      expect(await background('#canvas')).not.toBe(dark ? 'rgb(28, 31, 36)' : 'rgb(223, 224, 192)');
    } finally {
      await browser.close();
    }
  });
});
