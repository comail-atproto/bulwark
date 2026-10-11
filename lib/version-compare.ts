/**
 * Lenient semver comparison for the marketplace's `minAppVersion` gate.
 *
 * Parses "major.minor.patch" (any segment may be missing - treated as 0)
 * and ignores pre-release / build metadata. Returns negative, zero or
 * positive in the same shape as Array.prototype.sort comparators.
 *
 * We intentionally do NOT pull in a full semver dependency: plugins
 * declare minimum app versions as simple "X.Y.Z" strings and we only
 * need a >= check.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parseVersion(v: string): [number, number, number] {
  const cleaned = String(v || '').trim().replace(/^v/i, '');
  // Drop pre-release / build metadata.
  const core = cleaned.split(/[-+]/)[0];
  const parts = core.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * True when `current` satisfies `required` (i.e. current >= required).
 * Empty / null / undefined `required` is treated as no requirement.
 */
export function isVersionSatisfied(current: string, required: string | null | undefined): boolean {
  if (!required) return true;
  return compareVersions(current, required) >= 0;
}
