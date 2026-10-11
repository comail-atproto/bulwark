import { describe, expect, it } from 'vitest';
import { presetForSpaceOfferRole, spaceSharePresetOptions } from '@/lib/space-calendar/share-role';

describe('fixed Space offer role controls', () => {
  it('uses the configured viewer role for adding and offers no stronger role', () => {
    expect(presetForSpaceOfferRole('viewer')).toBe('read');
    expect(spaceSharePresetOptions('viewer')).toEqual(['read']);
  });

  it('uses the configured editor role for adding and offers no weaker role', () => {
    expect(presetForSpaceOfferRole('editor')).toBe('readWrite');
    expect(spaceSharePresetOptions('editor')).toEqual(['readWrite']);
  });

  it('fails closed when the configured offer role is missing', () => {
    expect(spaceSharePresetOptions(undefined)).toEqual([]);
  });
});
