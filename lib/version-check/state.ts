import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';
import type { UpdateStatus, VersionCheckStateFile } from './types';
import { DEFAULT_VERSION_ENDPOINT } from './types';

function getDir(): string {
  return process.env.VERSION_CHECK_DATA_DIR ||
    path.join(process.cwd(), 'data', 'version-check');
}

function statePath(): string { return path.join(getDir(), 'state.json'); }

const DEFAULTS: VersionCheckStateFile = {
  endpoint: DEFAULT_VERSION_ENDPOINT,
  lastCheckedAt: null,
  lastSuccessAt: null,
  nextScheduledAt: null,
  status: null,
};

export async function ensureDir(): Promise<void> {
  if (!existsSync(getDir())) await mkdir(getDir(), { recursive: true });
}

export async function loadState(): Promise<VersionCheckStateFile> {
  await ensureDir();
  try {
    const raw = await readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<VersionCheckStateFile>;
    return { ...DEFAULTS, ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('version-check: state read failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ...DEFAULTS };
  }
}

export async function saveState(state: VersionCheckStateFile): Promise<void> {
  await ensureDir();
  const tmp = statePath() + '.tmp';
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, statePath());
}

export function disabledByEnv(): boolean {
  const v = (process.env.BULWARK_UPDATE_CHECK ?? '').toLowerCase();
  if (v === 'off' || v === 'false' || v === '0' || v === 'no') return true;
  return false;
}

export function effectiveEndpoint(state: VersionCheckStateFile): string {
  // Env var wins over state file so an operator can override at runtime
  // without editing on-disk state. An explicit empty value disables the check.
  const envUrl = process.env.BULWARK_UPDATE_CHECK_URL;
  if (envUrl !== undefined) return envUrl.trim();
  return state.endpoint || DEFAULT_VERSION_ENDPOINT;
}

export function getCurrentVersion(): string {
  return (process.env.NEXT_PUBLIC_APP_VERSION || '').trim();
}

// A persisted status describes the build that was running when it was written.
// After an upgrade it is stale by definition - it can keep claiming "update
// available" for a version we no longer run - so nothing may surface it until
// the next check refreshes it (#913). If the running version is unknown we
// can't tell, so we leave the status alone rather than blanking the banner.
export function isStatusStale(
  status: UpdateStatus | null,
  current: string = getCurrentVersion(),
): boolean {
  if (!status || !current) return false;
  return status.current !== current;
}

export function freshStatus(state: VersionCheckStateFile): UpdateStatus | null {
  return isStatusStale(state.status) ? null : state.status;
}
