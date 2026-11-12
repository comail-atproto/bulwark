/**
 * The scripts' breakpoints follow the browser's default text size, as the
 * CSS breakpoints (Tailwind's rem) do. With a 32px default a 1440px window is
 * 45rem wide: the CSS draws the phone layout, so the scripts must pick it too,
 * or the mail screen showed only the reading pane with no list (LV-11).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobile, useIsDesktop, narrowerThan, atLeast } from '../use-media-query';

/** A window `px` wide whose default text size is `rootPx`. */
function viewport(px: number, rootPx: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /\(width (<|>=) ([\d.]+)rem\)/.exec(query);
    const matches = m ? (m[1] === '<' ? px < Number(m[2]) * rootPx : px >= Number(m[2]) * rootPx) : false;
    return { matches, media: query, addEventListener() {}, removeEventListener() {} };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('breakpoints', () => {
  it('writes the queries in rem, as Tailwind does', () => {
    expect(narrowerThan(768)).toBe('(width < 48rem)');
    expect(atLeast(1024)).toBe('(width >= 64rem)');
  });

  it('is a desktop at 1440px with the default 16px text', () => {
    viewport(1440, 16);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it('is a phone at 1440px when the browser text size is 32px', () => {
    viewport(1440, 32);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(false);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });
});
