import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migratePolicyUnifiedMailbox } from '../migrate';

// migratePolicyUnifiedMailbox reads ADMIN_CONFIG_DIR at call time (see paths.ts),
// so each test points it at a fresh temp dir.
let dir: string;
const policyPath = () => path.join(dir, 'policy.json');
const markerPath = () => path.join(dir, '.migrated-unified-mailbox');

const writePolicy = (features: Record<string, unknown>) =>
  writeFile(policyPath(), JSON.stringify({ features, restrictions: {} }, null, 2), 'utf-8');
const readFeatures = async () =>
  JSON.parse(await readFile(policyPath(), 'utf-8')).features as Record<string, unknown>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bw-policy-'));
  process.env.ADMIN_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.ADMIN_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('migratePolicyUnifiedMailbox', () => {
  it('enables unifiedCrossAccountEnabled when a cross view was active', async () => {
    await writePolicy({ crossUnreadViewEnabled: true });
    await migratePolicyUnifiedMailbox();
    expect((await readFeatures()).unifiedCrossAccountEnabled).toBe(true);
    expect(existsSync(markerPath())).toBe(true);
  });

  it('does not enable it for a standalone All-Mail-only policy', async () => {
    await writePolicy({ allMailViewEnabled: true, crossUnreadViewEnabled: false, crossStarredViewEnabled: false, crossAllViewEnabled: false });
    await migratePolicyUnifiedMailbox();
    expect((await readFeatures()).unifiedCrossAccountEnabled).toBeUndefined();
  });

  it('is a one-shot: a later admin disable survives a re-run', async () => {
    await writePolicy({ crossAllViewEnabled: true });
    await migratePolicyUnifiedMailbox();
    expect((await readFeatures()).unifiedCrossAccountEnabled).toBe(true);

    // Admin turns it back off; the marker is present, so re-running is a no-op.
    await writePolicy({ crossAllViewEnabled: true, unifiedCrossAccountEnabled: false });
    await migratePolicyUnifiedMailbox();
    expect((await readFeatures()).unifiedCrossAccountEnabled).toBe(false);
  });

  it('no policy.json: writes the marker and does not throw', async () => {
    await migratePolicyUnifiedMailbox();
    expect(existsSync(markerPath())).toBe(true);
    expect(existsSync(policyPath())).toBe(false);
  });
});
