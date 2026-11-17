import { test, expect } from '@playwright/test';
import type { SandboxInstance } from '../plugin-sandbox/host-bridge';

type FixtureWindow = Window & {
  pluginBrowser: { a: SandboxInstance; b: SandboxInstance; slot: SandboxInstance };
  attackerOrigins: string[];
};

test('production plugin frames isolate their document, identity and permissions', async ({ page }) => {
  await page.goto('/en/plugin-security-browser');
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).pluginBrowser));
  const result = await page.evaluate(async () => {
    const { a, b, slot } = (window as unknown as FixtureWindow).pluginBrowser;
    await Promise.all([a.initPromise, b.initPromise, slot.initPromise]);
    const sandbox = a.iframe.getAttribute('sandbox');
    const opaque = a.iframe.contentDocument === null;
    const first = await a.invokeHook('write', ['alpha']);
    const second = await b.invokeHook('write', ['beta']);
    const denied = await a.invokeHook('denied', []);
    await b.invokeHook('forge', []);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { sandbox, opaque, first, second, denied, a: await a.invokeHook('read', []), b: await b.invokeHook('read', []) };
  });
  expect(result.sandbox).toContain('allow-scripts');
  expect(result.sandbox).not.toContain('allow-same-origin');
  expect(result.opaque).toBe(true);
  expect(result).toMatchObject({ first: 'alpha', second: 'beta', a: 'alpha', b: 'beta' });
  expect(result.denied).toMatch(/lacks permission.*settings:read/);
  await expect(page.frameLocator('#slot iframe').locator('#plugin-rendered')).toHaveText('Plugin rendered');

  const replacement = await page.evaluate(async () => {
    const { a } = (window as unknown as FixtureWindow).pluginBrowser;
    const frame = a.iframe;
    frame.src = '/plugin-sandbox';
    await new Promise<void>((resolve) => {
      if (!frame.isConnected) return resolve();
      const observer = new MutationObserver(() => { if (!frame.isConnected) { observer.disconnect(); resolve(); } });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    try { await a.invokeHook('read', []); return 'answered'; } catch (error) { return String((error as Error).message); }
  });
  expect(replacement).toMatch(/destroyed|navigated away/);
});

test('refuses ready messages from other browser documents', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === '/plugin-sandbox', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto('/en/plugin-security-browser', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).pluginBrowser));
    await page.evaluate(() => {
      (window as unknown as FixtureWindow).attackerOrigins = [];
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'sandbox-ready' && event.data?.attacker) {
          (window as unknown as FixtureWindow).attackerOrigins.push(event.origin);
        }
      });
    });
    for (const sandboxed of [false, true]) {
      const id = sandboxed ? 'opaque-attacker' : 'same-origin-attacker';
      await page.evaluate(({ id, sandboxed }) => {
        const frame = document.createElement('iframe');
        frame.id = id;
        if (sandboxed) frame.setAttribute('sandbox', 'allow-scripts');
        frame.srcdoc = '<!doctype html><title>attacker</title>';
        document.body.appendChild(frame);
      }, { id, sandboxed });
      const frame = page.frameLocator(`#${id}`).locator('html');
      await expect(frame).toBeAttached();
      const attacker = await page.locator(`#${id}`).contentFrame();
      await attacker.locator('html').evaluate(() => {
        const activity = new MessageChannel();
        const rpc = new MessageChannel();
        parent.postMessage({ type: 'sandbox-ready', attacker: true }, '*', [activity.port2, rpc.port2]);
      });
    }
    await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).attackerOrigins.length)).toBe(2);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).attackerOrigins)).toEqual([new URL(page.url()).origin, 'null']);
    const state = await page.evaluate(() => Promise.race([
      (window as unknown as FixtureWindow).pluginBrowser.a.readyPromise.then(() => 'accepted', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 250)),
    ]));
    expect(state).toBe('pending');
  } finally {
    release();
  }
  await page.evaluate(() => (window as unknown as FixtureWindow).pluginBrowser.a.initPromise);
});
