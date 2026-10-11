import { describe, it, expect } from 'vitest';
import { compareVersions, isVersionSatisfied } from '@/lib/version-compare';

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('treats missing segments as 0', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('tolerates a leading v', () => {
    expect(compareVersions('v1.6.7', '1.6.7')).toBe(0);
  });

  it('ignores pre-release / build metadata', () => {
    expect(compareVersions('1.6.7-rc.1', '1.6.7')).toBe(0);
    expect(compareVersions('1.6.7+build.5', '1.6.7')).toBe(0);
  });
});

describe('isVersionSatisfied', () => {
  it('returns true when current >= required', () => {
    expect(isVersionSatisfied('1.6.7', '1.6.7')).toBe(true);
    expect(isVersionSatisfied('1.6.8', '1.6.7')).toBe(true);
    expect(isVersionSatisfied('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns false when current < required', () => {
    expect(isVersionSatisfied('1.6.6', '1.6.7')).toBe(false);
    expect(isVersionSatisfied('1.5.0', '1.6.0')).toBe(false);
    expect(isVersionSatisfied('0.0.0', '1.0.0')).toBe(false);
  });

  it('treats empty / null / undefined required as no requirement', () => {
    expect(isVersionSatisfied('1.0.0', '')).toBe(true);
    expect(isVersionSatisfied('1.0.0', null)).toBe(true);
    expect(isVersionSatisfied('1.0.0', undefined)).toBe(true);
  });
});
