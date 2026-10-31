import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { UpdateStatus, VersionCheckStateFile } from '@/lib/version-check/types';

let dir: string;

function statusFor(current: string, latest: string, updateAvailable: boolean): UpdateStatus {
  return {
    schema: 1,
    current,
    latest,
    updateAvailable,
    severity: updateAvailable ? 'normal' : 'none',
    url: 'https://example.invalid/release',
    advisory: null,
    checkedAt: '2026-08-25T21:33:19.432Z',
  };
}

async function writeStateFile(state: Partial<VersionCheckStateFile>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(state), 'utf8');
}

async function readStateFile(): Promise<VersionCheckStateFile> {
  return JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')) as VersionCheckStateFile;
}

describe('version-check across an upgrade (#913)', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'bulwark-version-check-'));
    process.env.VERSION_CHECK_DATA_DIR = dir;
    process.env.NEXT_PUBLIC_APP_VERSION = '1.9.0';
    delete process.env.BULWARK_UPDATE_CHECK;
    process.env.BULWARK_UPDATE_CHECK_URL = 'https://version.invalid/';
  });

  afterEach(async () => {
    const { stopScheduler } = await import('@/lib/version-check');
    await stopScheduler();
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.VERSION_CHECK_DATA_DIR;
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    delete process.env.BULWARK_UPDATE_CHECK_URL;
    await rm(dir, { recursive: true, force: true });
  });

  describe('freshStatus', () => {
    it('hides a status persisted by the previous version', async () => {
      const { freshStatus } = await import('@/lib/version-check');
      const state = {
        endpoint: '', lastCheckedAt: null, lastSuccessAt: null, nextScheduledAt: null,
        status: statusFor('1.7.8', '1.9.0', true),
      } satisfies VersionCheckStateFile;
      expect(freshStatus(state)).toBeNull();
    });

    it('keeps a status written by the running version', async () => {
      const { freshStatus } = await import('@/lib/version-check');
      const status = statusFor('1.9.0', '1.9.0', false);
      const state = {
        endpoint: '', lastCheckedAt: null, lastSuccessAt: null, nextScheduledAt: null, status,
      } satisfies VersionCheckStateFile;
      expect(freshStatus(state)).toBe(status);
    });

    it('keeps the status when the running version is unknown', async () => {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
      const { freshStatus } = await import('@/lib/version-check');
      const status = statusFor('1.7.8', '1.9.0', true);
      const state = {
        endpoint: '', lastCheckedAt: null, lastSuccessAt: null, nextScheduledAt: null, status,
      } satisfies VersionCheckStateFile;
      expect(freshStatus(state)).toBe(status);
    });
  });

  describe('startScheduler', () => {
    it('drops the old status and checks promptly instead of honoring the old schedule', async () => {
      // State left behind by 1.7.8, with its next check still ~55 min out.
      const future = new Date(Date.now() + 55 * 60 * 1000).toISOString();
      await writeStateFile({
        endpoint: 'https://version.invalid/',
        lastCheckedAt: '2026-08-25T21:33:19.432Z',
        lastSuccessAt: '2026-08-25T21:33:19.432Z',
        nextScheduledAt: future,
        status: statusFor('1.7.8', '1.9.0', true),
      });

      const { startScheduler } = await import('@/lib/version-check');
      await startScheduler();

      const after = await readStateFile();
      expect(after.status).toBeNull();
      // Rescheduled to the ~30s startup delay, not the inherited 55 minutes.
      const inMs = new Date(after.nextScheduledAt!).getTime() - Date.now();
      expect(inMs).toBeLessThan(60_000);
    });

    it('still honors a future schedule written by the running version', async () => {
      const future = new Date(Date.now() + 55 * 60 * 1000).toISOString();
      await writeStateFile({
        endpoint: 'https://version.invalid/',
        lastCheckedAt: '2026-08-25T21:33:19.432Z',
        lastSuccessAt: '2026-08-25T21:33:19.432Z',
        nextScheduledAt: future,
        status: statusFor('1.9.0', '1.9.0', false),
      });

      const { startScheduler } = await import('@/lib/version-check');
      await startScheduler();

      const after = await readStateFile();
      expect(after.status).not.toBeNull();
      const inMs = new Date(after.nextScheduledAt!).getTime() - Date.now();
      expect(inMs).toBeGreaterThan(50 * 60 * 1000);
    });
  });

  describe('selectBanner', () => {
    it('does not show a banner for a status cached by the previous version', async () => {
      const { selectBanner, selectHasUpdate } = await import('@/stores/update-store');
      const state = {
        status: statusFor('1.7.8', '1.9.0', true),
        loading: false,
        lastFetchedAt: null,
        fetchStatus: async () => {},
        startPolling: () => {},
        stopPolling: () => {},
      };
      expect(selectBanner(state)).toBeNull();
      expect(selectHasUpdate(state)).toBe(false);
    });

    it('still shows a banner for a status from the running version', async () => {
      const { selectBanner, selectHasUpdate } = await import('@/stores/update-store');
      const state = {
        status: statusFor('1.9.0', '1.9.1', true),
        loading: false,
        lastFetchedAt: null,
        fetchStatus: async () => {},
        startPolling: () => {},
        stopPolling: () => {},
      };
      expect(selectBanner(state)?.severity).toBe('normal');
      expect(selectHasUpdate(state)).toBe(true);
    });
  });
});
