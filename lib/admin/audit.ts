import { appendFile, stat, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/logger';
import { ensureStateDir, getStatePath } from './paths';
import type { AuditEntry } from './types';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS = 3;
const AUDIT_LOG_FILE = 'audit.log';

function getAuditLogPath(): string {
  return getStatePath(AUDIT_LOG_FILE);
}

/**
 * Append an audit entry to the admin audit log. Stored under the state dir
 * so it remains writable when the config dir is mounted read-only.
 */
export async function auditLog(action: string, detail: Record<string, unknown>, ip: string): Promise<void> {
  await ensureStateDir();

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    action,
    detail,
    ip,
  };

  const logPath = getAuditLogPath();
  try {
    await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    await rotateIfNeeded(logPath);
  } catch (error) {
    logger.error('Failed to write audit log', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function rotateIfNeeded(logPath: string): Promise<void> {
  try {
    const stats = await stat(logPath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate: audit.log.3 → deleted, audit.log.2 → .3, audit.log.1 → .2, audit.log → .1
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
      const to = `${logPath}.${i}`;
      if (existsSync(from)) {
        try { await rename(from, to); } catch { /* target may exist on overwrite */ }
      }
    }
  } catch {
    // stat failed, probably file doesn't exist yet
  }
}

/**
 * Read audit log entries, newest first. Supports pagination.
 */
export async function readAuditLog(page: number = 1, limit: number = 50, actionFilter?: string): Promise<{ entries: AuditEntry[]; total: number }> {
  const logPath = getAuditLogPath();
  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let entries: AuditEntry[] = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((e): e is AuditEntry => e !== null);

    if (actionFilter) {
      entries = entries.filter(e => e.action === actionFilter);
    }

    const total = entries.length;
    entries.reverse();
    const start = (page - 1) * limit;
    return { entries: entries.slice(start, start + limit), total };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], total: 0 };
    }
    logger.warn('Failed to read audit log', { error: error instanceof Error ? error.message : 'Unknown error' });
    return { entries: [], total: 0 };
  }
}
