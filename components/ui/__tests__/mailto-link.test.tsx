import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MailtoLink } from '../mailto-link';
import { INTERNAL_MAILTO_EVENT } from '@/lib/protocol-handlers/mailto';
import type { ParsedMailto } from '@/lib/protocol-handlers/mailto';

/**
 * Address links in the app's own chrome must compose in place: handing a
 * mailto: URL to the OS mail handler goes nowhere in a webmail client. The
 * element stays an anchor with a real href so "Copy email address", middle
 * click and assistive technology keep working - only the plain click is
 * redirected, and only when a listener actually takes it.
 */

function listenAndHandle(): { seen: ParsedMailto[] } {
  const seen: ParsedMailto[] = [];
  const handler = (event: Event) => {
    seen.push((event as CustomEvent<ParsedMailto>).detail);
    event.preventDefault();
  };
  window.addEventListener(INTERNAL_MAILTO_EVENT, handler);
  listeners.push(() => window.removeEventListener(INTERNAL_MAILTO_EVENT, handler));
  return { seen };
}

let listeners: Array<() => void> = [];

describe('MailtoLink', () => {
  beforeEach(() => {
    listeners = [];
  });

  afterEach(() => {
    listeners.forEach((off) => off());
    cleanup();
  });

  it('keeps a real mailto href so copy/middle-click still work', () => {
    render(<MailtoLink to="ada@example.com">Email</MailtoLink>);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'mailto:ada@example.com');
  });

  it('requests the internal composer instead of the OS handler', async () => {
    const { seen } = listenAndHandle();
    render(<MailtoLink to="ada@example.com">Email</MailtoLink>);

    const link = screen.getByRole('link');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);

    expect(seen).toHaveLength(1);
    expect(seen[0].to).toEqual(['ada@example.com']);
    // Default prevented => the browser does not follow the mailto: URL.
    expect(click.defaultPrevented).toBe(true);
  });

  it('passes subject and cc through when given a full mailto URL', () => {
    const { seen } = listenAndHandle();
    render(<MailtoLink to="mailto:ada@example.com?subject=Hi&cc=bob@example.com">Email</MailtoLink>);

    screen.getByRole('link').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(seen[0].subject).toBe('Hi');
    expect(seen[0].cc).toEqual(['bob@example.com']);
  });

  it('leaves the click alone when no listener takes it', () => {
    render(<MailtoLink to="ada@example.com">Email</MailtoLink>);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole('link').dispatchEvent(click);

    // Nothing handled it - fall back to the browser rather than swallowing.
    expect(click.defaultPrevented).toBe(false);
  });

  it('leaves modified clicks to the browser', () => {
    const { seen } = listenAndHandle();
    render(<MailtoLink to="ada@example.com">Email</MailtoLink>);

    // Ctrl-click / middle click are the user's own "open elsewhere" gestures.
    fireEvent.click(screen.getByRole('link'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('link'), { button: 1 });

    expect(seen).toHaveLength(0);
  });
});
