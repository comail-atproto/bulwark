import { describe, it, expect } from 'vitest';
import { CVD_COLORS, cvdColor, cvdHue } from '../cvd-palette';

describe('cvdHue', () => {
  it('maps the default calendar and tag colours onto separate palette colours', () => {
    expect(cvdHue('#ef4444')).toBe('vermillion');
    expect(cvdHue('#f97316')).toBe('orange');
    expect(cvdHue('#eab308')).toBe('yellow');
    expect(cvdHue('#22c55e')).toBe('bluishGreen');
    expect(cvdHue('#06b6d4')).toBe('skyBlue');
    expect(cvdHue('#3b82f6')).toBe('blue');
    expect(cvdHue('#a855f7')).toBe('reddishPurple');
  });

  it('keeps red and green apart, the pair red-green colour blindness merges', () => {
    expect(cvdHue('#dc2626')).not.toBe(cvdHue('#16a34a'));
    expect(cvdHue('#b91c1c')).toBe('vermillion');
    expect(cvdHue('#15803d')).toBe('bluishGreen');
  });

  it('reads tag palette names, with their light and dark shades', () => {
    expect(cvdHue('red')).toBe('vermillion');
    expect(cvdHue('teal-light')).toBe('skyBlue');
    expect(cvdHue('indigo-dark')).toBe('blue');
    expect(cvdHue('gray')).toBe('grey');
  });

  it('reads short hex, rgb() and hsl()', () => {
    expect(cvdHue('#f00')).toBe('vermillion');
    expect(cvdHue('rgb(0, 128, 0)')).toBe('bluishGreen');
    expect(cvdHue('hsl(220, 80%, 50%)')).toBe('blue');
  });

  it('turns greys grey and gives up on what it cannot read', () => {
    expect(cvdHue('#777777')).toBe('grey');
    expect(cvdHue('var(--color-primary)')).toBeNull();
    expect(cvdHue('')).toBeNull();
    expect(cvdHue(undefined)).toBeNull();
  });
});

describe('cvdColor', () => {
  it('draws a colour as it is while the setting is off', () => {
    expect(cvdColor('#3b82f6', false)).toBe('#3b82f6');
  });

  it('draws the palette colour while it is on, and leaves unreadable colours alone', () => {
    expect(cvdColor('#3b82f6', true)).toBe(CVD_COLORS.blue);
    expect(cvdColor('var(--color-primary)', true)).toBe('var(--color-primary)');
  });
});
