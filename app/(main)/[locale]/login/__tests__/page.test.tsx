import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import LoginPage from '../page';
import { COMAIL_THEME } from '@/lib/__tests__/fixtures/comail-theme';
import { useThemeStore } from '@/stores/theme-store';

const searchState = vi.hoisted(() => ({ value: '' }));

const configState = vi.hoisted(() => ({
  appName: 'Webmail',
  jmapServerUrl: 'https://jmap.example.com',
  oauthEnabled: false,
  oauthOnly: false,
  oauthClientId: '',
  oauthIssuerUrl: '',
  oauthScopes: '',
  rememberMeEnabled: false,
  devMode: false,
  demoMode: false,
  autoSsoEnabled: false,
  atprotoLoginUrl: 'https://relay.example.com/atproto/login',
  loginLogoLightUrl: '/logo.svg',
  loginLogoDarkUrl: '/logo-dark.svg',
  loginCompanyName: '',
  loginImprintUrl: '',
  loginPrivacyPolicyUrl: '',
  loginWebsiteUrl: '',
  buildersWebsiteUrl: 'https://build.comail.at',
  hostedInboxLogoutDestination: '',
  sourceCodeUrl: '',
  loginLogoMaxHeight: '',
  loginLogoMaxWidth: '',
  loginShowHeading: true,
  loginShowSubtitle: true,
  allowCustomJmapEndpoint: false,
  jmapServers: [],
  jmapServerAutoPickByDomain: false,
  embeddedMode: false,
  isLoading: false,
  error: null,
}));

// `resolveHandle` is the unit under test at the page boundary: its return value
// drives the block-vs-redirect decision in handleAtprotoLogin. We mock it so the
// page-level tests can drive each branch (invalid / unknown / resolved)
// deterministically without monkey-patching fetch.
vi.mock('@/lib/atproto/handle', () => ({
  resolveHandle: vi.fn(),
  searchActorsTypeahead: vi.fn(async () => []),
  normalizeHandle: (raw: string) => raw.trim().replace(/^@/, '').toLowerCase(),
  APPVIEW_BASE: 'https://public.api.bsky.app',
}));

import { resolveHandle, searchActorsTypeahead } from '@/lib/atproto/handle';

// Minimal store mocks. The login page reads a handful of fields from each
// store; only the fields the render path touches need to be populated.
vi.mock('@/stores/auth-store', () => {
  const state = {
    isLoading: false,
    error: null as string | null,
    isAuthenticated: false,
    login: vi.fn(async () => true),
    loginDemo: vi.fn(async () => true),
    clearError: vi.fn(),
    removeAccount: vi.fn(),
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  return { useAuthStore: hook, consumeSignedOut: () => false };
});

// zustand-shaped mock: the hook accepts a selector and also carries the
// store-level `subscribe`/`getState` APIs that other modules (settings-store's
// theme-sync wiring) call at import time.
function makeStore<T extends object>(initial: T) {
  const state = { ...initial };
  const hook = (sel?: (s: T) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  hook.setState = (p: Partial<T>) => Object.assign(state, p);
  hook.subscribe = () => () => {};
  return hook;
}

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: makeStore({
    theme: 'system' as const,
    resolvedTheme: 'light' as const,
    setTheme: vi.fn(),
    initializeTheme: vi.fn(),
  }),
}));

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: makeStore({ locale: 'en' as const }),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: makeStore({ settingsSyncDisabled: true }),
}));

vi.mock('@/stores/update-store', () => ({
  useUpdateStore: makeStore({ startPolling: vi.fn(), status: null, loading: false, lastFetchedAt: null }),
  selectBanner: () => null,
}));

vi.mock('@/stores/account-store', () => ({
  useAccountStore: makeStore({ accounts: [{ id: 'failed', username: 'saved@example.test', hasError: true, isConnected: false }], getNextCookieSlot: () => 0 }),
}));

vi.mock('@/stores/policy-store', () => ({
  usePolicyStore: () => ({ fetchPolicy: vi.fn() }),
}));

// useConfig drives which login branch renders. Force the atproto-only branch
// (atprotoLoginUrl set, no demo/dev/oauth) so the handle form is present.
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => configState,
}));

// next/navigation provides useSearchParams (read for mobile handoff params) and
// useParams (read for the locale). The global vitest.setup.ts mock does not
// include useSearchParams, so provide it here returning an empty search.
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(searchState.value),
  usePathname: () => '/en',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// @/i18n/navigation's useRouter is read at module load by the page.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en',
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// Capture the handoff URL the atproto path navigates to. jsdom's real
// window.location throws "Not implemented: navigation" on `href =` assignment,
// so swap in a plain mock for the duration of each test.
interface MockLocation {
  href: string;
  replace: ReturnType<typeof vi.fn>;
  assign: ReturnType<typeof vi.fn>;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

function installMockLocation(): MockLocation {
  const mock: MockLocation = {
    href: '',
    replace: vi.fn(),
    assign: vi.fn(),
    origin: 'http://localhost',
    // getPathPrefix() reads pathname.split('/'); an empty-root path yields no
    // locale segment, so the prefix resolves to '' (no sub-path mount).
    pathname: '/',
    search: '',
    hash: '',
  };
  Object.defineProperty(window, 'location', {
    value: mock,
    writable: true,
    configurable: true,
  });
  return mock;
}

function installMockStorage() {
  const makeStorage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() { return values.size; },
    };
  };
  Object.defineProperty(window, 'localStorage', {
    value: makeStorage(),
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: makeStorage(),
    configurable: true,
  });
}

function typeHandle(value: string) {
  const input = screen.getByLabelText('atproto_handle_label');
  fireEvent.change(input, { target: { value } });
}

function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'sign_in' }));
}

describe('LoginPage atproto handle submit (handleAtprotoLogin)', () => {
  const mockedResolveHandle = vi.mocked(resolveHandle);

  it('exposes the login card inside main with a top-level heading', () => {
    render(<LoginPage />);
    const main = screen.getByRole('main');
    expect(main.querySelectorAll('h1')).toHaveLength(1);
    expect(main.querySelector('h1, h3')?.tagName).toBe('H1');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    searchState.value = "";
    vi.mocked(searchActorsTypeahead).mockResolvedValue([]);
    useThemeStore.setState({ theme: 'system', resolvedTheme: 'light' });
    configState.atprotoLoginUrl = 'https://relay.example.com/atproto/login';
    configState.sourceCodeUrl = '';
    configState.loginWebsiteUrl = '';
    configState.buildersWebsiteUrl = 'https://build.comail.at';
    vi.stubEnv('NEXT_PUBLIC_CORRESPONDING_SOURCE_URL', 'https://tangled.org/comail.at/bulwark');
    installMockStorage();
    installMockLocation();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('replaces the hosted sign-in form with the server-confirmed waitlist signup', async () => {
    searchState.value = 'state=waitlist&handle=forged.example.test';
    configState.atprotoLoginUrl = 'http://localhost/webmail/login';
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      state: 'waitlist', csrf: 'proof', did: 'did:plc:verified', handle: 'alice.bsky.social', recorded: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    try {
      render(<LoginPage />);
      await screen.findByRole('heading', { name: 'waitlist.title' });
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.getByText('waitlist.saved')).toBeInTheDocument();
      expect(screen.queryByText('forged.example.test')).not.toBeInTheDocument();
      expect(request).toHaveBeenCalledWith('http://localhost/inbox/waitlist/session', expect.objectContaining({ credentials: 'same-origin' }));
    } finally { request.mockRestore(); }
  });

  it('offers the public fork source and one builders link in the header', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /^Source$/ })).toHaveAttribute('href', 'https://tangled.org/comail.at/bulwark');
    const buildersLinks = screen.getAllByRole('link').filter(link => /^https:\/\/build\.comail\.at\/?$/.test(link.getAttribute('href') || ''));
    expect(buildersLinks).toHaveLength(1);
    expect(screen.getByRole('banner')).toContainElement(buildersLinks[0]);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('offers the build-configured source from the Comail login footer', () => {
    const sourceUrl = 'https://source.example.com/releases/build-revision.tar.gz';
    vi.stubEnv('NEXT_PUBLIC_CORRESPONDING_SOURCE_URL', sourceUrl);
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /^Source$/ })).toHaveAttribute('href', sourceUrl);
  });

  it('defaults to Spooky and lets people choose Light and Dark without changing their mailbox theme', () => {
    render(<LoginPage />);
    const shell = screen.getByTestId('comail-atproto-login');
    expect(shell).toHaveAttribute('data-comail-theme', 'spooky');
    for (const [label, value] of [['Light', 'light'], ['Dark', 'dark'], ['Spooky', 'spooky']]) {
      fireEvent.click(screen.getByRole('button', { name: /^Theme:/ }));
      expect(screen.getAllByRole('option')).toHaveLength(3);
      fireEvent.click(screen.getByRole('option', { name: label }));
      expect(shell).toHaveAttribute('data-comail-theme', value);
      expect(localStorage.getItem('comail-login-theme')).toBe(value);
      expect(screen.getByRole('button', { name: `Theme: ${label}` })).toBeInTheDocument();
    }
    expect(useThemeStore.getState().setTheme).not.toHaveBeenCalled();
  });

  it.each(['light', 'dark', 'spooky'])('restores the explicit %s login theme', value => {
    localStorage.setItem('comail-login-theme', value);
    render(<LoginPage />);
    expect(screen.getByTestId('comail-atproto-login')).toHaveAttribute('data-comail-theme', value);
  });

  it('keeps the theme picker usable when login theme storage is blocked', () => {
    const getItem = localStorage.getItem.bind(localStorage);
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(key => {
      if (key === 'comail-login-theme') throw new Error('blocked');
      return getItem(key);
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'comail-login-theme') throw new Error('blocked');
      setItem(key, value);
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Spooky' }));
    fireEvent.click(screen.getByRole('option', { name: 'Light' }));
    expect(screen.getByTestId('comail-atproto-login')).toHaveAttribute('data-comail-theme', 'light');
  });

  it('offers the operator-configured source from the Comail login footer', () => {
    configState.sourceCodeUrl = 'https://source.example.com/releases/tested-revision.tar.gz';
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /^Source$/ })).toHaveAttribute('href', configState.sourceCodeUrl);
  });

  it('uses the configured staging websites in the header and footer', () => {
    configState.loginWebsiteUrl = 'https://site.stage.test';
    configState.buildersWebsiteUrl = 'https://builders.stage.test';
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'comail' })).toHaveAttribute('href', configState.loginWebsiteUrl);
    expect(screen.getByRole('link', { name: 'comail_builders' })).toHaveAttribute('href', configState.buildersWebsiteUrl);
    for (const [name, path] of [['Terms', '/terms'], ['Privacy', '/privacy'], ['Docs', '/docs']]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', configState.loginWebsiteUrl + path);
    }
  });

  it('keeps the hosted marketing shell and its links in both themes without changing the saved preference', () => {
    localStorage.setItem('comail-login-theme', 'dark');
    useThemeStore.setState({ theme: 'system', resolvedTheme: 'dark' });
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'comail' })).toHaveAttribute('href', 'https://comail.at');
    expect(screen.getByRole('link', { name: 'comail_builders' })).toHaveAttribute('href', 'https://build.comail.at');
    expect(screen.getByRole('link', { name: 'comail' }).querySelector('img[alt="comail"]')).toHaveAttribute('src', '/branding/comail/comail-logo-dark.svg');
    expect(screen.getByRole('heading', { name: 'comail_welcome' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'footer' })).toHaveTextContent('Source');
    expect(screen.getByRole('button', { name: 'comail_continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    fireEvent.click(screen.getByRole('option', { name: 'Light' }));
    expect(screen.getByRole('link', { name: 'comail' }).querySelector('img[alt="comail"]')).toHaveAttribute('src', '/branding/comail/comail-logo.svg');
    expect(screen.getByTestId('comail-atproto-login')).toHaveAttribute('data-comail-theme', 'light');
    expect(screen.getByRole('link', { name: 'comail' }).querySelector('img')).toHaveAttribute('src', '/branding/comail/cammie-mark.png');
    expect(useThemeStore.getState().setTheme).not.toHaveBeenCalled();
  });

  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('uses marketing colors despite the mailbox skin and respects reduced motion', async () => {
    vi.mocked(searchActorsTypeahead).mockResolvedValue([{ did: 'did:plc:test', handle: 'alice.bsky.social', displayName: 'Alice' }]);
    const { container } = render(<LoginPage />);
    typeHandle('alice.bsky.social');
    await screen.findByRole('option', { name: /alice.bsky.social/ });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    mockedResolveHandle.mockResolvedValue({ status: 'invalid' });
    submit();
    await screen.findByRole('alert');
    const cssPath = path.resolve('app/globals.css');
    const css = await postcss([tailwindcss()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
    const theme = COMAIL_THEME;
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await page.setContent(`<!doctype html><html><head><style>${css.css}\n${theme.css}\n${theme.skin}</style></head><body data-theme-skin="builtin-comail">${container.innerHTML}</body></html>`);
      for (const dark of [false, true]) {
        await page.getByTestId('comail-atproto-login').evaluate((el, value) => { el.dataset.comailTheme = value ? 'dark' : 'light'; }, dark);
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        const shell = page.getByTestId('comail-atproto-login');
        expect(await shell.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Atkinson Hyperlegible');
        expect(await shell.locator('h1').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Young Serif');
        expect(await shell.locator('h1').evaluate(el => getComputedStyle(el).fontWeight)).toBe('400');
        await expect.poll(() => shell.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(dark ? 'rgb(2, 65, 60)' : 'rgb(223, 224, 192)');
        const input = page.getByRole('combobox');
        expect(await input.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(dark ? 'rgb(3, 54, 49)' : 'rgb(245, 245, 224)');
        expect(await input.evaluate(el => getComputedStyle(el).color)).toBe(dark ? 'rgb(223, 224, 192)' : 'rgb(1, 33, 2)');
        expect(await input.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Atkinson Hyperlegible');
        const button = page.getByRole('button', { name: 'comail_continue' });
        expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(dark ? 'rgb(223, 224, 192)' : 'rgb(2, 65, 60)');
        expect(await button.evaluate(el => getComputedStyle(el).color)).toBe(dark ? 'rgb(2, 65, 60)' : 'rgb(223, 224, 192)');
        expect(await page.locator('#atproto-handle-error').evaluate(el => getComputedStyle(el).color)).toBe(dark ? 'rgb(255, 170, 170)' : 'rgb(164, 38, 38)');
        const suggestion = page.getByRole('option', { name: /alice.bsky.social/ });
        expect(await suggestion.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(dark ? 'rgb(24, 85, 78)' : 'rgb(207, 211, 177)');
        await input.focus();
        expect(await input.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
        expect(await page.locator('.comail-login-envelopes').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      }
      await page.getByTestId('comail-atproto-login').evaluate(el => { el.dataset.comailTheme = 'spooky'; });
      for (const dark of [false, true]) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        const shell = page.getByTestId('comail-atproto-login');
        await expect.poll(() => shell.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(49, 54, 56)');
        const input = page.getByRole('combobox');
        expect(await input.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(87, 71, 41)');
        expect(await input.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 229, 150)');
        const button = page.getByRole('button', { name: 'comail_continue' });
        expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 173, 59)');
        expect(await button.evaluate(el => getComputedStyle(el).color)).toBe('rgb(49, 54, 56)');
      }
    } finally {
      await browser.close();
    }
  }, 30_000);

  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('keeps optional email readable in both themes despite the mailbox skin', async () => {
    searchState.value = 'state=waitlist';
    configState.atprotoLoginUrl = 'http://localhost/webmail/login';
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      state: 'waitlist', csrf: 'proof', did: 'did:plc:verified', handle: 'alice.bsky.social', recorded: true,
    }), { status: 200 }));
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
    try {
      const { container } = render(<LoginPage />);
      await screen.findByText('waitlist.saved');
      const cssPath = path.resolve('app/globals.css');
      const css = await postcss([tailwindcss()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
      const theme = COMAIL_THEME;
      const page = await browser.newPage();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 });
        for (const skin of ['default', 'spooky']) {
          for (const dark of [false, true]) {
            await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
            await page.setContent(`<!doctype html><html><head><style>${css.css}\n${theme.css}\n${theme.skin}</style></head><body data-theme-skin="builtin-comail">${container.innerHTML}</body></html>`);
            await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
            await page.getByTestId('comail-atproto-login').evaluate((el, value) => { el.dataset.comailTheme = value; }, skin === 'spooky' ? 'spooky' : dark ? 'dark' : 'light');
            await page.locator('summary').click();
            for (const selector of ['[role="status"]', '#waitlist-email-title', 'summary', 'label']) {
              await expect.poll(() => page.locator(selector).evaluate(el => getComputedStyle(el).color)).toBe(skin === 'spooky' ? 'rgb(255, 229, 150)' : dark ? 'rgb(223, 224, 192)' : 'rgb(1, 33, 2)');
            }
            const input = page.locator('#waitlist-email');
            await expect.poll(() => input.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(skin === 'spooky' ? 'rgb(87, 71, 41)' : dark ? 'rgb(3, 54, 49)' : 'rgb(245, 245, 224)');
            await expect.poll(() => input.evaluate(el => getComputedStyle(el).color)).toBe(skin === 'spooky' ? 'rgb(255, 229, 150)' : dark ? 'rgb(223, 224, 192)' : 'rgb(1, 33, 2)');
            expect(await input.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Atkinson Hyperlegible');
            expect(await page.getByRole('heading', { name: 'waitlist.title' }).evaluate(el => getComputedStyle(el).fontFamily)).toContain('Young Serif');
            const contrast = await page.locator('.comail-login').evaluate(shell => {
              const luminance = (color: string) => {
                const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
                  const channel = value / 255;
                  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                });
                return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
              };
              const background = luminance(getComputedStyle(shell).backgroundColor);
              return [...shell.querySelectorAll('.text-muted-foreground')].map(element => {
                const foreground = luminance(getComputedStyle(element).color);
                return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
              });
            });
            expect(contrast.length).toBeGreaterThan(0);
            expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    } finally {
      request.mockRestore();
      await browser.close();
    }
  }, 30_000);

  it('leaves the generic password login intact when atproto mode is not configured', () => {
    configState.atprotoLoginUrl = '';
    render(<LoginPage />);

    expect(screen.queryByTestId('comail-atproto-login')).not.toBeInTheDocument();
    expect(screen.getByLabelText('username_label')).toBeInTheDocument();
    expect(screen.getByLabelText('password_label')).toBeInTheDocument();
  });

  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('fits the viewport with version details inside the page and scrolls when content needs space', async () => {
    const { container } = render(<LoginPage />);
    const cssPath = path.resolve('app/globals.css');
    const css = await postcss([tailwindcss()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
    for (const image of container.querySelectorAll('img')) {
      const source = image.getAttribute('src')!;
      const bytes = await readFile(path.resolve('public', source.slice(1)));
      const mime = source.endsWith('.svg') ? 'image/svg+xml' : source.endsWith('.gif') ? 'image/gif' : 'image/png';
      image.src = `data:${mime};base64,${bytes.toString('base64')}`;
    }
    const browser = await chromium.launch({ executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>${css.css}</style></head><body>${container.innerHTML}</body></html>`);
      for (const viewport of [{ width: 1960, height: 1020 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const dimensions = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        }));
        expect(dimensions).toEqual(viewport);
        if (process.env.COMAIL_WORDMARK_EVIDENCE) {
          await page.getByRole('link', { name: 'comail', exact: true }).screenshot({ path: `${process.env.COMAIL_WORDMARK_EVIDENCE}/inbox-login-wordmark-${viewport.width}.png` });
        }
        await page.mouse.move(0, 0);
        await page.getByRole('link', { name: 'Terms', exact: true }).click({ trial: true, timeout: 1_000 });
        const badge = page.locator('footer .peer');
        await badge.hover();
        const details = badge.locator('xpath=following-sibling::div');
        await expect.poll(() => details.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        const bounds = await details.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
        await details.getByRole('button', { name: 'copy', exact: true }).hover();
        expect(await details.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
      }
      await page.setViewportSize({ width: 390, height: 320 });
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(320);
      await page.locator('footer').scrollIntoViewIfNeeded();
      const footerBounds = await page.locator('footer').boundingBox();
      expect(footerBounds!.y).toBeGreaterThanOrEqual(0);
      expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(320);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it('renders an inline error (role=alert) and does NOT navigate when resolveHandle returns invalid', async () => {
    mockedResolveHandle.mockResolvedValue({ status: 'invalid' });

    render(<LoginPage />);
    typeHandle('nope.invalid');
    submit();

    // The inline error block carries role=alert per the page markup.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('atproto_handle_invalid');
    // No navigation should have occurred: the handoff URL is never assigned.
    expect(window.location.href).toBe('');
  });

  it('proceeds to the handoff URL when resolveHandle returns unknown (fail-open, incl. timeout)', async () => {
    mockedResolveHandle.mockResolvedValue({ status: 'unknown' });

    render(<LoginPage />);
    typeHandle('maybe.bsky.social');
    submit();

    await waitFor(() => {
      expect(window.location.href).toContain('https://relay.example.com/atproto/login');
    });
    expect(window.location.href).toContain('handle=maybe.bsky.social');
    expect(window.location.href).not.toContain('handle=undefined');
  });

  it('navigates to the handoff URL when resolveHandle returns resolved', async () => {
    mockedResolveHandle.mockResolvedValue({ status: 'resolved', did: 'did:plc:abc' });

    render(<LoginPage />);
    typeHandle('alice.bsky.social');
    submit();

    await waitFor(() => {
      expect(window.location.href).toContain('https://relay.example.com/atproto/login');
    });
    expect(window.location.href).toContain('handle=alice.bsky.social');
  });
});
