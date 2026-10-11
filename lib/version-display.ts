// Single source of truth for how the login-page version affordance renders its
// lines (issue #1768). Keeps the version string from being duplicated and hides
// a meaningless "Build: unknown" on production builds where the git SHA was not
// injected, while still surfacing it locally for debugging.

export interface VersionLine {
  label: "Version" | "Build" | "Latest";
  value: string;
}

export interface VersionLineInput {
  version: string;
  build: string;
  isProd: boolean;
  latest?: string;
}

/**
 * Whether the Build line should be shown. An empty or "unknown" build is only
 * meaningful off-prod; on prod it is noise (the SHA simply was not baked in) so
 * we suppress it.
 */
export function shouldShowBuild(build: string, isProd: boolean): boolean {
  const known = build.trim().length > 0 && build.trim() !== "unknown";
  if (known) return true;
  return !isProd;
}

/**
 * Build the ordered list of version lines. Version appears exactly once.
 */
export function buildVersionLines({
  version,
  build,
  isProd,
  latest,
}: VersionLineInput): VersionLine[] {
  const lines: VersionLine[] = [{ label: "Version", value: version }];
  if (shouldShowBuild(build, isProd)) {
    lines.push({ label: "Build", value: build });
  }
  if (latest) {
    lines.push({ label: "Latest", value: latest });
  }
  return lines;
}
