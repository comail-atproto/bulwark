import { describe, it, expect } from 'vitest';
import { buildVersionLines, shouldShowBuild } from '@/lib/version-display';

// Acceptance criteria (issue #1768):
//  - version string shown once (single source of truth)
//  - "Build: unknown" hidden on prod
describe('shouldShowBuild', () => {
  it('hides an unknown build on prod', () => {
    expect(shouldShowBuild('unknown', true)).toBe(false);
  });

  it('shows an unknown build off-prod (local/dev) for debugging', () => {
    expect(shouldShowBuild('unknown', false)).toBe(true);
  });

  it('shows a real build hash on prod', () => {
    expect(shouldShowBuild('a1b2c3d', true)).toBe(true);
  });

  it('treats empty build as unknown', () => {
    expect(shouldShowBuild('', true)).toBe(false);
  });
});

describe('buildVersionLines', () => {
  it('omits the Build line when the build is unknown on prod', () => {
    const lines = buildVersionLines({ version: '1.7.6', build: 'unknown', isProd: true });
    expect(lines).toEqual([{ label: 'Version', value: '1.7.6' }]);
    expect(lines.find((l) => l.label === 'Build')).toBeUndefined();
  });

  it('includes the Build line when the build is known', () => {
    const lines = buildVersionLines({ version: '1.7.6', build: 'a1b2c3d', isProd: true });
    expect(lines).toEqual([
      { label: 'Version', value: '1.7.6' },
      { label: 'Build', value: 'a1b2c3d' },
    ]);
  });

  it('lists Version exactly once (single source, no duplication)', () => {
    const lines = buildVersionLines({ version: '1.7.6', build: 'a1b2c3d', isProd: true });
    const versionLines = lines.filter((l) => l.label === 'Version');
    expect(versionLines).toHaveLength(1);
  });

  it('appends the latest-available line when provided', () => {
    const lines = buildVersionLines({
      version: '1.7.6',
      build: 'a1b2c3d',
      isProd: true,
      latest: '1.8.0',
    });
    expect(lines).toContainEqual({ label: 'Latest', value: '1.8.0' });
  });
});
