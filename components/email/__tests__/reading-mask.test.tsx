import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReadingMask, maskBand } from '../reading-mask';

describe('maskBand', () => {
  it('centres the band on the pointer', () => {
    expect(maskBand(300, 60, 100, 900)).toEqual({ start: 270, end: 330 });
  });
  it('keeps the band inside the message', () => {
    expect(maskBand(90, 60, 100, 900)).toEqual({ start: 100, end: 160 });
    expect(maskBand(990, 60, 100, 900)).toEqual({ start: 840, end: 900 });
  });
});

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="host" style={{ position: 'relative' }}>
      <p>text</p>
      <ReadingMask containerRef={ref} frame={null} bandHeight={60} />
    </div>
  );
}

describe('ReadingMask', () => {
  it('dims above and below a band that follows the pointer, without catching clicks', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'host'
        ? ({ top: 100, bottom: 900, left: 0, right: 800, height: 800, width: 800 } as DOMRect)
        : ({ top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 } as DOMRect);
    });
    render(<Host />);
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    const mask = screen.getByTestId('reading-mask');
    expect(mask).toHaveAttribute('aria-hidden', 'true');
    expect(mask.className).toContain('pointer-events-none');

    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 400 }) as PointerEvent);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const [above, below] = Array.from(mask.children) as HTMLElement[];
    // Band 370..430 in the viewport, 270..330 in the message.
    expect(above.style.height).toBe('270px');
    expect(below.style.top).toBe('330px');
    vi.restoreAllMocks();
  });
});
