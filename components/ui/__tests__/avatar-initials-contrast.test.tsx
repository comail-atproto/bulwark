import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../avatar';
import { getLuminance, parseColor } from '@/lib/color-transform';

// LV-10: white initials failed 4.5:1 on the light generated colours.

function ratio(fg: string, bg: string): number {
  const [la, lb] = [parseColor(fg)!, parseColor(bg)!].map((c) => getLuminance(c.r, c.g, c.b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('avatar initials', () => {
  it('read at 4.5:1 on any generated colour', () => {
    for (const name of ['Alice Smith', 'Bob Chen', 'Carol Lee', 'Dev User', 'Erik Ström', 'Fatima Noor', 'Gao Wei', 'Hana Kim']) {
      const { container, unmount } = render(<Avatar name={name} disableImages />);
      const el = container.firstElementChild as HTMLElement;
      expect(ratio(el.style.color, el.style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      unmount();
    }
  });
});
