import { existsSync } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';

/**
 * Admin data directories.
 *
 * Two dirs intentionally split (issue #226):
 *   - CONFIG: holds operator-authored state (config.json, policy.json,
 *     admin.json passwordHash, plugins, themes, branding uploads). Can be
 *     mounted read-only after initial setup.
 *   - STATE: holds runtime mutations (admin-state.json with login timestamps,
 *     audit.log, .setup-token). Always read-write.
 *
 * Resolution order:
 *   getConfigDir()
 *     1. ADMIN_CONFIG_DIR
 *     2. ADMIN_DATA_DIR (legacy)
 *     3. <cwd>/data/admin
 *
 *   getStateDir()
 *     1. ADMIN_STATE_DIR
 *     2. <ADMIN_CONFIG_DIR>/state - if config dir was set explicitly
 *     3. <ADMIN_DATA_DIR>/state - back-compat: stays on the legacy volume
 *     4. <cwd>/data/admin-state - fresh-install default; matches the
 *        sibling mount in docker-compose.yml
 *
 * The legacy ADMIN_DATA_DIR keeps existing single-volume mounts working
 * unchanged: everything ends up under it, with state in a `state/` subdir.
 * Fresh installs and the docker-compose default keep state in a separate
 * sibling dir so the config dir can be mounted :ro after setup.
 */

export function getConfigDir(): string {
  return (
    process.env.ADMIN_CONFIG_DIR ||
    process.env.ADMIN_DATA_DIR ||
    path.join(process.cwd(), 'data', 'admin')
  );
}

export function getStateDir(): string {
  if (process.env.ADMIN_STATE_DIR) return process.env.ADMIN_STATE_DIR;
  if (process.env.ADMIN_CONFIG_DIR) {
    return path.join(process.env.ADMIN_CONFIG_DIR, 'state');
  }
  if (process.env.ADMIN_DATA_DIR) {
    return path.join(process.env.ADMIN_DATA_DIR, 'state');
  }
  return path.join(process.cwd(), 'data', 'admin-state');
}

export function getConfigPath(filename: string): string {
  return path.join(getConfigDir(), filename);
}

export function getStatePath(filename: string): string {
  return path.join(getStateDir(), filename);
}

export async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

export async function ensureStateDir(): Promise<void> {
  const dir = getStateDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// ─── Read-only mode ─────────────────────────────────────────────────────────

let cachedReadOnly: boolean | null = null;

/**
 * Whether the config dir is locked. Operators set ADMIN_CONFIG_READONLY=true
 * after running the setup wizard and remounting the volume :ro.
 *
 * When true, all writes to the config dir are refused at the application
 * layer (cleaner error than a mid-request EROFS).
 */
export function isConfigReadOnly(): boolean {
  if (cachedReadOnly !== null) return cachedReadOnly;
  const v = (process.env.ADMIN_CONFIG_READONLY || '').toLowerCase();
  cachedReadOnly = v === 'true' || v === '1' || v === 'yes';
  return cachedReadOnly;
}

/**
 * Probe the config dir by writing a temp file. Used to auto-detect RO mounts
 * when ADMIN_CONFIG_READONLY is not set explicitly. Run once at startup;
 * cheap on local FS, can be slow on networked FS, hence opt-in.
 */
export async function probeConfigReadOnly(): Promise<boolean> {
  if (process.env.ADMIN_CONFIG_READONLY) return isConfigReadOnly();
  try {
    const probe = path.join(getConfigDir(), '.rw-probe');
    await writeFile(probe, '');
    await unlink(probe);
    cachedReadOnly = false;
    return false;
  } catch {
    cachedReadOnly = true;
    logger.info('Config dir is read-only (auto-detected)');
    return true;
  }
}

export class ConfigReadOnlyError extends Error {
  constructor(operation: string) {
    super(
      `Cannot ${operation}: configuration is read-only. ` +
        `Remount the config volume read-write or unset ADMIN_CONFIG_READONLY.`
    );
    this.name = 'ConfigReadOnlyError';
  }
}

export function assertWritable(operation: string): void {
  if (isConfigReadOnly()) throw new ConfigReadOnlyError(operation);
}
