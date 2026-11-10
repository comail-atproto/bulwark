import { describe, it, expect, afterEach, vi } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from '../reduced-motion';
import { scrollToSettingsSection } from '@/components/settings/settings-section';
import { scrollToStart } from '@/hooks/use-scroll-window';

function systemPrefers(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

afterEach(() => {
  document.documentElement.removeAttribute('data-motion');
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('prefersReducedMotion', () => {
  it('follows the operating system while the setting is System', () => {
    systemPrefers(true);
    expect(prefersReducedMotion()).toBe(true);
    systemPrefers(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reduces motion when the setting is On, whatever the system says', () => {
    systemPrefers(false);
    document.documentElement.setAttribute('data-motion', 'reduce');
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it('keeps motion when the setting is Off, whatever the system says', () => {
    systemPrefers(true);
    document.documentElement.setAttribute('data-motion', 'full');
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });
});

describe('scripted scrolling', () => {
  it('jumps to a settings section instead of gliding when motion is reduced', () => {
    systemPrefers(true);
    document.body.innerHTML = '<div data-settings-section="fonts"></div>';
    const el = document.querySelector<HTMLElement>('[data-settings-section="fonts"]')!;
    el.scrollIntoView = vi.fn();
    expect(scrollToSettingsSection('fonts')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('still glides to a calendar day when motion is not reduced', () => {
    systemPrefers(false);
    const el = document.createElement('div');
    el.scrollTo = vi.fn() as typeof el.scrollTo;
    scrollToStart(el, 'vertical', 120);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'smooth' });
    document.documentElement.setAttribute('data-motion', 'reduce');
    scrollToStart(el, 'vertical', 40);
    expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 40, behavior: 'auto' });
  });
});
