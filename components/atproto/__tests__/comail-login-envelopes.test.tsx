// @vitest-environment node
import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

for (const theme of ['light', 'dark', 'spooky']) {
  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')(`animates transparent ${theme} artwork across desktop and phone layouts`, async () => {
    const bundle = await build({
      stdin: {
        contents: `import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { ComailLoginEnvelopes } from './components/atproto/comail-login-envelopes';
          const root = createRoot(document.getElementById('art'));
          window.unmountArtwork = () => root.unmount();
          root.render(<div className="comail-login" data-comail-theme="${theme}">
            <ComailLoginEnvelopes theme="${theme}" /><form><label htmlFor="handle">Your handle</label>
            <input id="handle" /><button>Continue</button></form></div>);`,
        resolveDir: process.cwd(), loader: 'tsx',
      },
      bundle: true, write: false, jsx: 'automatic',
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    });
    const css = await readFile('app/comail-login.css', 'utf8');
    const loaded = new Set<string>();
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
    try {
      const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
      await page.route('https://login.example.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (/\.(gif|webp)$/.test(pathname)) {
          loaded.add(pathname);
          await route.fulfill({ contentType: pathname.endsWith('.gif') ? 'image/gif' : 'image/webp', body: await readFile(path.join('public', pathname)) });
        } else {
          await route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
            ${css}
            body { margin: 0; }
            form { margin: auto; padding: 24px; } label { display: block; }
            </style><div id="art"></div>
            <script>${bundle.outputFiles[0].text}</script>` });
        }
      });
      await page.goto('https://login.example.test/');
      await expect.poll(() => loaded.size).toBe(3);
      const canvas = page.locator('canvas');
      for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height })))
          .toEqual({ width: viewport.width * 2, height: viewport.height * 2 });
        const readInk = () => canvas.evaluate((el: HTMLCanvasElement) => {
          const pixels = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
          let painted = 0;
          let otherColors = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 32) continue;
            painted++;
            if (pixels[i + 1] - pixels[i] < 70 || pixels[i + 2] - pixels[i + 1] < 15) otherColors++;
          }
          return { painted, otherColors };
        });
        await expect.poll(async () => (await readInk()).painted).toBeGreaterThan(1500);
        const ink = await readInk();
        if (theme !== 'spooky') {
          // Canvas interpolation can shift translucent edge pixels outside the palette.
          expect(ink.otherColors / ink.painted).toBeLessThanOrEqual(0.001);
        } else expect(ink.otherColors).toBeGreaterThan(1500);
        expect(await canvas.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
        await page.locator('#handle').fill('alice.example.test');
        await page.getByRole('button', { name: 'Continue' }).click({ trial: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      }
      expect([...loaded].every(source => theme === 'spooky' ? source.endsWith('.webp') : source.endsWith('.gif'))).toBe(true);
      for (const dark of [false, true]) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        expect(await page.locator('.comail-login').evaluate(el => getComputedStyle(el).backgroundColor))
          .toBe(theme === 'spooky' ? 'rgb(49, 54, 56)' : theme === 'dark' ? 'rgb(2, 65, 60)' : 'rgb(223, 224, 192)');
      }
      const frame = () => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
      const first = await frame();
      await expect.poll(frame).not.toBe(first);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await canvas.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const still = await frame();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await frame()).toBe(still);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect.poll(frame).not.toBe(still);
      await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true'; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overridden = await frame();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await frame()).toBe(overridden);
      await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'false'; });
      await expect.poll(frame).not.toBe(overridden);
      const detachedCanvas = await canvas.elementHandle();
      await page.evaluate(() => (window as unknown as { unmountArtwork(): void }).unmountArtwork());
      const detached = await detachedCanvas!.evaluate((el: HTMLCanvasElement) => el.toDataURL());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await detachedCanvas!.evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(detached);
    } finally {
      await browser.close();
    }
  }, 30_000);
}
