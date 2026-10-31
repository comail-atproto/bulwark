import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enableThemeColorSync,
  syncThemeColorMeta,
  resetThemeColorSyncForTests,
} from '@/lib/theme-color-meta';

const meta = () => document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

/** The module defers to rAF; run callbacks inline so assertions stay synchronous. */
beforeEach(() => {
  resetThemeColorSyncForTests();
  document.head.innerHTML = '';
  document.body.removeAttribute('style');
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function withServerMeta(color: string) {
  const el = document.createElement('meta');
  el.name = 'theme-color';
  el.content = color;
  document.head.appendChild(el);
}

describe('theme color meta sync (#671)', () => {
  it('does nothing until enabled, so an admin-set colour is left alone', () => {
    withServerMeta('#123456');
    document.body.style.backgroundColor = '#282a36';

    syncThemeColorMeta();

    expect(meta()?.content).toBe('#123456');
  });

  it('adopts the painted background once enabled', () => {
    withServerMeta('#ffffff');
    document.body.style.backgroundColor = 'rgb(40, 42, 54)';

    enableThemeColorSync();

    expect(meta()?.content).toBe('rgb(40, 42, 54)');
  });

  it('follows subsequent theme changes', () => {
    withServerMeta('#ffffff');
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    enableThemeColorSync();
    expect(meta()?.content).toBe('rgb(255, 255, 255)');

    document.body.style.backgroundColor = 'rgb(10, 10, 10)';
    syncThemeColorMeta();
    expect(meta()?.content).toBe('rgb(10, 10, 10)');
  });

  it('creates the meta tag when the document has none', () => {
    document.body.style.backgroundColor = 'rgb(1, 2, 3)';

    enableThemeColorSync();

    expect(meta()?.content).toBe('rgb(1, 2, 3)');
  });

  it('keeps the existing value when the background is transparent', () => {
    withServerMeta('#abcdef');
    document.body.style.backgroundColor = 'rgba(0, 0, 0, 0)';

    enableThemeColorSync();

    expect(meta()?.content).toBe('#abcdef');
  });

  it('coalesces a burst of changes into a single write', () => {
    withServerMeta('#ffffff');
    document.body.style.backgroundColor = 'rgb(9, 9, 9)';
    enableThemeColorSync();

    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);

    // A theme switch flips the light/dark class and re-injects CSS; only the
    // first call should schedule a frame.
    syncThemeColorMeta();
    syncThemeColorMeta();
    syncThemeColorMeta();

    expect(raf).toHaveBeenCalledTimes(1);
  });
});
