import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const page = {
    goto: vi.fn(),
    locator: vi.fn(),
    screenshot: vi.fn(),
  };
  const form = { waitFor: vi.fn() };
  const browser = { newPage: vi.fn(), close: vi.fn() };
  return { page, form, browser, launch: vi.fn() };
});

vi.mock('@playwright/test', () => ({ chromium: { launch: fixture.launch } }));
// Fake timers must cover Date too: the readiness wait compares Date.now()
// against its deadline, so a clock that does not advance would never expire.
const FAKE_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ['setTimeout', 'clearTimeout', 'Date'] };

/** Drains the 2s readiness polls until the deadline check throws. */
async function settleStartup(): Promise<Error> {
  const settled = globalSetup().then(
    () => new Error('globalSetup resolved instead of timing out'),
    (error: unknown) => error as Error,
  );
  await vi.runAllTimersAsync();
  return settled;
}
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  mkdirSync: vi.fn(),
}));

import globalSetup from '../../integration/tests/global-setup';

beforeEach(() => {
  vi.stubEnv('IT_NO_DOCKER', '1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  fixture.launch.mockResolvedValue(fixture.browser);
  fixture.browser.newPage.mockResolvedValue(fixture.page);
  fixture.browser.close.mockResolvedValue(undefined);
  fixture.page.goto.mockResolvedValue(undefined);
  fixture.page.locator.mockReturnValue(fixture.form);
  fixture.page.screenshot.mockResolvedValue(undefined);
  fixture.form.waitFor.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each([
  { name: 'ready login form', failure: '' },
  { name: 'page creation fails', failure: 'page' },
  { name: 'login form never becomes ready', failure: 'form' },
])('integration startup closes its browser when $name', async ({ failure }) => {
  if (failure === 'page') fixture.browser.newPage.mockRejectedValueOnce(new Error('startup failed'));
  if (failure === 'form') fixture.form.waitFor.mockRejectedValueOnce(new Error('startup failed'));
  if (failure) await expect(globalSetup()).rejects.toThrow('startup failed');
  else await globalSetup();
  expect(fixture.browser.close).toHaveBeenCalledOnce();
});

it('does not create a page when browser launch fails', async () => {
  fixture.launch.mockRejectedValueOnce(new Error('launch failed'));
  await expect(globalSetup()).rejects.toThrow('launch failed');
  expect(fixture.browser.newPage).not.toHaveBeenCalled();
});

it.each([
  {
    name: 'DNS resolution fails',
    reply: async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND stalwart'), { code: 'ENOTFOUND' }),
      });
    },
    last: 'ENOTFOUND',
  },
  {
    name: 'HTTP endpoint is not ready',
    reply: async () => new Response(null, { status: 503, statusText: 'Service Unavailable' }),
    last: 'HTTP 503',
  },
])('readiness reports its last failure without credentials when $name', async ({ reply, last }) => {
  vi.useFakeTimers(FAKE_TIMERS);
  const deadline = Date.now() + 240000;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (Date.now() >= deadline) throw new DOMException('deadline abort hides the last failure', 'TimeoutError');
    return reply();
  }));
  const error = await settleStartup();
  expect(error.message).toContain('last attempt:');
  expect(error.message).toContain(last);
  expect(error.message).not.toContain('test-pass-123');
});
