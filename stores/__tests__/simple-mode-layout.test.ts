import { describe, expect, it } from 'vitest';
import { effectiveMailLayout } from '../settings-store';

describe('simple mode layout (CO-12)', () => {
  it('shows one column: the list, then the message in its place', () => {
    expect(effectiveMailLayout('split', 'default', true)).toBe('focus');
    expect(effectiveMailLayout('horizontal', 'default', true)).toBe('focus');
  });

  it('keeps the saved layout without simple mode', () => {
    expect(effectiveMailLayout('split', 'default', false)).toBe('split');
    expect(effectiveMailLayout('split', 'default')).toBe('split');
  });
});
