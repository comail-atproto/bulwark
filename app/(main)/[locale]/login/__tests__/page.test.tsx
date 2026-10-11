import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import LoginPage from '../page';

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
  // The HandleCombobox imports these but the atproto form never fires a
  // typeahead lookup during a single submit, so no-op implementations suffice.
  searchActorsTypeahead: vi.fn(async () => []),
  normalizeHandle: (raw: string) => raw.trim().replace(/^@/, '').toLowerCase(),
  looksLikeHandle: (v: string) => v.includes('.') || v.startsWith('did:'),
  APPVIEW_BASE: 'https://public.api.bsky.app',
}));

import { resolveHandle } from '@/lib/atproto/handle';

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
  useAccountStore: () => ({ getNextCookieSlot: () => 0 }),
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
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

// @/i18n/navigation's useRouter is read at module load by the page.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
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
  // The atproto form has no accessible name, so `getByRole('form')` does not
  // match it under jsdom (a <form> only exposes role=form when labeled).
  // Query the element directly and dispatch a submit event instead.
  const form = document.querySelector('form');
  if (!form) throw new Error('atproto form was not rendered');
  fireEvent.submit(form);
}

describe('LoginPage atproto handle submit (handleAtprotoLogin)', () => {
  const mockedResolveHandle = vi.mocked(resolveHandle);

  beforeEach(() => {
    vi.clearAllMocks();
    configState.atprotoLoginUrl = 'https://relay.example.com/atproto/login';
    configState.sourceCodeUrl = '';
    installMockStorage();
    installMockLocation();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers the public fork source from the Comail login footer by default', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /^Source$/ })).toHaveAttribute('href', 'https://github.com/comail-atproto/bulwark');
  });

  it('offers the operator-configured source from the Comail login footer', () => {
    configState.sourceCodeUrl = 'https://source.example.com/releases/tested-revision.tar.gz';
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /^Source$/ })).toHaveAttribute('href', configState.sourceCodeUrl);
  });

  it('renders the Comail split-panel shell only for the hosted atproto entry', () => {
    render(<LoginPage />);

    const shell = screen.getByTestId('comail-atproto-login');
    expect(shell).toBeInTheDocument();
    expect(shell.querySelector('aside')).toHaveClass('bg-background');
    expect(shell.querySelector('section')).toHaveClass('bg-sidebar');
    const animatedCammie = shell.querySelector('img[src$="/branding/comail/cammie-wiggle.gif"]');
    expect(animatedCammie).toBeInTheDocument();
    expect(animatedCammie).toHaveClass('w-56');
    expect(animatedCammie?.parentElement).not.toHaveClass('bg-card');
    expect(screen.getByText('comail inbox')).toBeInTheDocument();
    expect(screen.getByText('your inbox, atproto-native')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'sign_in' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'footer' })).toHaveTextContent(
      'Terms · Privacy · Acceptable use · Docs · FAQ · About · Source',
    );
    expect(screen.getByText(/Follow us/)).toHaveTextContent('@comail.at');
  });

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
        await details.getByRole('button', { name: 'Copy version info' }).hover();
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
