'use client';

import { useEffect, useState } from 'react';
import { ThemeProvider as UpstreamThemeProvider } from './theme-provider';
import { extractTheme } from '@/lib/plugin-validator';
import type { InstalledTheme } from '@/lib/plugin-types';
import { withBasePath } from '@/lib/browser-navigation';
import { useThemeStore } from '@/stores/theme-store';
import manifest from '@/themes/comail/manifest.json';

let installation: Promise<void> | undefined;

async function loadComailTheme() {
  const existing = useThemeStore.getState().installedThemes.find(theme => theme.id === manifest.id);
  if (existing?.builtIn && existing.version === manifest.version && existing.css && existing.skin) return;
  if (installation) return installation;
  installation = (async () => {
    const response = await fetch(withBasePath(`/branding/comail/${manifest.id}-${manifest.version}.zip`), { cache: 'force-cache' });
    if (!response.ok) throw new Error('Bundled theme download failed');
    const result = await extractTheme(new File([await response.arrayBuffer()], `${manifest.id}.zip`));
    if (!result.valid || !result.skin || result.manifest?.id !== manifest.id || result.manifest.version !== manifest.version) {
      throw new Error('Bundled theme package is invalid');
    }
    // Bundled themes stay available when IndexedDB is unavailable. Keep
    // their reserved IDs and built-in controls, including existing policy rules.
    const theme: InstalledTheme = {
      ...result.manifest, css: result.css, skin: result.skin ?? undefined, enabled: true, builtIn: true,
    };
    useThemeStore.setState(state => ({
      installedThemes: [theme, ...state.installedThemes.filter(item => item.id !== theme.id)],
    }));
  })().finally(() => { installation = undefined; });
  return installation;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [restoreComailChoice] = useState(() => {
    // Upstream hydration drops built-ins absent from its source list. Read
    // the saved choice before its provider persists a replacement default.
    try {
      return JSON.parse(localStorage.getItem('theme-storage') ?? 'null')?.state?.activeThemeId === manifest.id;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mounted = true;
    if (restoreComailChoice) useThemeStore.setState({ activeThemeId: manifest.id });
    void loadComailTheme().then(() => {
      if (mounted) useThemeStore.getState().initializeTheme();
    }).catch(() => { console.warn('[comail-theme] Bundled theme could not be loaded'); });
    return () => { mounted = false; };
  }, [restoreComailChoice]);
  return <UpstreamThemeProvider>{children}</UpstreamThemeProvider>;
}
