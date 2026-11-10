import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../comail-theme-provider';
import { BUILTIN_THEMES } from '@/lib/builtin-themes';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { useThemeStore } from '@/stores/theme-store';

const bytes = readFileSync('public/branding/comail/builtin-comail-1.0.1.zip');

beforeEach(() => {
  localStorage.clear();
  document.head.querySelectorAll('#active-theme, #active-theme-skin').forEach(el => el.remove());
  document.body.removeAttribute('data-theme-skin');
  document.documentElement.classList.remove('dark');
  vi.stubGlobal('File', File);
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  usePolicyStore.setState({ policy: structuredClone(DEFAULT_POLICY), loaded: true });
  useThemeStore.setState({
    installedThemes: BUILTIN_THEMES.filter(theme => theme.id !== 'builtin-comail'),
    theme: 'light', resolvedTheme: 'light', activeThemeId: null, hydrated: false,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ready() {
  await waitFor(() => expect(useThemeStore.getState().installedThemes.some(theme => theme.id === 'builtin-comail')).toBe(true));
}

describe('bundled Comail theme', () => {
  it('loads the package once at startup without IndexedDB and keeps bundled-theme controls', async () => {
    render(<StrictMode><ThemeProvider><p>Mailbox</p></ThemeProvider></StrictMode>);
    await ready();
    expect(screen.getByText('Mailbox')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useThemeStore.getState().activeThemeId).toBe('builtin-comail');
    expect(document.body.getAttribute('data-theme-skin')).toBe('builtin-comail');
    expect(useThemeStore.getState().installedThemes[0]).toMatchObject({ id: 'builtin-comail', builtIn: true });
    expect(document.querySelector('#active-theme')?.textContent).toContain('--color-background: #dfe0c0;');
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.querySelector('#active-theme-skin')?.textContent).toContain('.dark body[data-theme-skin="builtin-comail"]');
    useThemeStore.getState().uninstallTheme('builtin-comail');
    expect(useThemeStore.getState().installedThemes.some(theme => theme.id === 'builtin-comail')).toBe(true);
  });

  it.each(['user', 'default', 'forced'])('preserves the %s choice of another theme', async (choice) => {
    useThemeStore.setState({ activeThemeId: choice === 'user' ? 'builtin-nord' : null });
    if (choice === 'default') usePolicyStore.setState(state => ({ policy: {
      ...state.policy, themePolicy: { ...state.policy.themePolicy, defaultThemeId: 'builtin-nord' },
    } }));
    if (choice === 'forced') usePolicyStore.setState(state => ({ policy: {
      ...state.policy, forceEnabledThemes: ['builtin-nord'],
    } }));
    render(<ThemeProvider><p>Mailbox</p></ThemeProvider>);
    await ready();
    expect(useThemeStore.getState().activeThemeId).toBe('builtin-nord');
    expect(document.body.getAttribute('data-theme-skin')).not.toBe('builtin-comail');
  });

  it('restores the same ID and dark mode from an older saved built-in theme', async () => {
    usePolicyStore.setState(state => ({ policy: {
      ...state.policy, themePolicy: { ...state.policy.themePolicy, defaultThemeId: 'builtin-nord' },
    } }));
    localStorage.setItem('theme-storage', JSON.stringify({ version: 0, state: {
      theme: 'dark', activeThemeId: 'builtin-comail', installedThemes: [{
        id: 'builtin-comail', builtIn: true, version: '1.0.0', css: 'old bundled colors',
      }],
    } }));
    await useThemeStore.persist.rehydrate();
    render(<ThemeProvider><p>Mailbox</p></ThemeProvider>);
    await ready();
    expect(useThemeStore.getState().activeThemeId).toBe('builtin-comail');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.querySelector('#active-theme')?.textContent).toContain('--color-background: #1c1f24;');
    expect(document.querySelector('#active-theme')?.textContent).not.toContain('old bundled colors');
  });

  it('retains legacy policy restrictions for the bundled theme', async () => {
    usePolicyStore.setState(state => ({ policy: {
      ...state.policy, themePolicy: { ...state.policy.themePolicy, disabledBuiltinThemes: ['builtin-comail'] },
    } }));
    render(<ThemeProvider><p>Mailbox</p></ThemeProvider>);
    await ready();
    const theme = useThemeStore.getState().installedThemes.find(theme => theme.id === 'builtin-comail')!;
    expect(usePolicyStore.getState().isThemeDisabled(theme.id, !!theme.builtIn)).toBe(true);
  });

  it('keeps a user choice made while the package is downloading', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    render(<ThemeProvider><p>Mailbox</p></ThemeProvider>);
    useThemeStore.getState().activateTheme('builtin-nord');
    finish(new Response(bytes));
    await ready();
    expect(useThemeStore.getState().activeThemeId).toBe('builtin-nord');
  });

  it('does not apply a late download after the provider has unmounted', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const { unmount } = render(<ThemeProvider><p>Mailbox</p></ThemeProvider>);
    unmount();
    finish(new Response(bytes));
    await ready();
    expect(document.body.getAttribute('data-theme-skin')).not.toBe('builtin-comail');
  });

  it('keeps the app usable when the package cannot be downloaded', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status: 503 }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useThemeStore.setState({ activeThemeId: 'builtin-nord' });
    render(<ThemeProvider><p>Mailbox</p></ThemeProvider>);
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(screen.getByText('Mailbox')).toBeTruthy();
    expect(useThemeStore.getState().activeThemeId).toBe('builtin-nord');
  });
});
