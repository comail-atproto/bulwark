import { describe, it, expect, vi, afterEach } from 'vitest';

// `browser-navigation` reads NEXT_PUBLIC_BASE_PATH into a module-load constant
// (mirroring how next.config.ts bakes basePath in at build time), so each case
// has to re-import the module under a fresh env. These tests pin down the
// promise made to subpath deployments: the built-in branding *defaults*
// (FAVICON_URL, LOGIN_LOGO_*) — not just admin-set custom values — get the
// mount prefix, because every consumer wraps them in withBasePath(). See #330.
async function loadNav(basePath?: string) {
  vi.resetModules();
  if (basePath === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  } else {
    process.env.NEXT_PUBLIC_BASE_PATH = basePath;
  }
  return import('@/lib/browser-navigation');
}

// The fallback values from CONFIG_ENV_MAP that ship in the box.
const DEFAULT_FAVICON = '/branding/Bulwark_Favicon.svg';
const DEFAULT_LOGIN_LOGO_LIGHT = '/branding/Bulwark_Logo_Color.svg';
const DEFAULT_LOGIN_LOGO_DARK = '/branding/Bulwark_Logo_White.svg';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  vi.resetModules();
});

describe('withBasePath — asset-URL fallbacks under a subpath', () => {
  it('leaves branding defaults untouched when no base path is set', async () => {
    const { withBasePath } = await loadNav(undefined);
    // jsdom's window.location.pathname is "/", so runtime detection finds no
    // prefix either — the default paths pass through unchanged.
    expect(withBasePath(DEFAULT_FAVICON)).toBe(DEFAULT_FAVICON);
    expect(withBasePath(DEFAULT_LOGIN_LOGO_LIGHT)).toBe(DEFAULT_LOGIN_LOGO_LIGHT);
    expect(withBasePath(DEFAULT_LOGIN_LOGO_DARK)).toBe(DEFAULT_LOGIN_LOGO_DARK);
  });

  it('prefixes the built-in favicon and login-logo defaults', async () => {
    const { withBasePath } = await loadNav('/webmail');
    expect(withBasePath(DEFAULT_FAVICON)).toBe('/webmail/branding/Bulwark_Favicon.svg');
    expect(withBasePath(DEFAULT_LOGIN_LOGO_LIGHT)).toBe('/webmail/branding/Bulwark_Logo_Color.svg');
    expect(withBasePath(DEFAULT_LOGIN_LOGO_DARK)).toBe('/webmail/branding/Bulwark_Logo_White.svg');
  });

  it('is idempotent for an already-prefixed value (no double prefix)', async () => {
    const { withBasePath } = await loadNav('/webmail');
    expect(withBasePath('/webmail/branding/Bulwark_Favicon.svg')).toBe('/webmail/branding/Bulwark_Favicon.svg');
    expect(withBasePath('/webmail')).toBe('/webmail');
  });

  it('passes through external, protocol-relative, data, and empty values', async () => {
    const { withBasePath } = await loadNav('/webmail');
    expect(withBasePath('https://cdn.example.com/logo.svg')).toBe('https://cdn.example.com/logo.svg');
    expect(withBasePath('//cdn.example.com/logo.svg')).toBe('//cdn.example.com/logo.svg');
    expect(withBasePath('data:image/svg+xml,<svg/>')).toBe('data:image/svg+xml,<svg/>');
    expect(withBasePath('')).toBe('');
    expect(withBasePath(null)).toBe('');
    expect(withBasePath(undefined)).toBe('');
  });

  it('strips a trailing slash on the configured base path', async () => {
    const { withBasePath, getPathPrefix } = await loadNav('/webmail/');
    expect(getPathPrefix()).toBe('/webmail');
    expect(withBasePath(DEFAULT_FAVICON)).toBe('/webmail/branding/Bulwark_Favicon.svg');
  });

  it('getPathPrefix reports the static base path on the server (no window needed)', async () => {
    const { getPathPrefix } = await loadNav('/webmail');
    // SSR consumers (layout.tsx favicon metadata, manifest.ts) rely on this
    // resolving from the build-time constant rather than window.location.
    expect(getPathPrefix()).toBe('/webmail');
  });
});

describe('toRouterPath — router.push paths under a subpath', () => {
  // With a build-time basePath, Next's router prepends the prefix itself, so
  // browser-derived paths (redirect_after_login stores
  // window.location.pathname) must be stripped or the redirect lands on
  // /webmail/webmail/en. See #390.
  it('strips the static base path from a stored browser path', async () => {
    const { toRouterPath } = await loadNav('/webmail');
    expect(toRouterPath('/webmail/en')).toBe('/en');
    expect(toRouterPath('/webmail/en/calendar?view=day')).toBe('/en/calendar?view=day');
    expect(toRouterPath('/webmail')).toBe('/');
    expect(toRouterPath('/webmail?compose=1')).toBe('/?compose=1');
  });

  it('leaves already-stripped and unrelated paths alone', async () => {
    const { toRouterPath } = await loadNav('/webmail');
    expect(toRouterPath('/en')).toBe('/en');
    expect(toRouterPath('/')).toBe('/');
    // Shares the prefix text but is a different first segment.
    expect(toRouterPath('/webmail2/en')).toBe('/webmail2/en');
  });

  it('passes paths through unchanged when no base path is built in', async () => {
    // Legacy runtime-detected proxy mounts: Next knows nothing about the
    // prefix, so router.push needs the full prefixed path.
    const { toRouterPath } = await loadNav(undefined);
    expect(toRouterPath('/webmail/en')).toBe('/webmail/en');
    expect(toRouterPath('/en')).toBe('/en');
  });
});
