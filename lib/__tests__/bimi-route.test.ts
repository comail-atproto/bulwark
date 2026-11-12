// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { BimiIndicator } from '@/lib/bimi/lookup';

const resolve = vi.hoisted(() => vi.fn(async (_domain: string): Promise<BimiIndicator | null> => null));
vi.mock('@/lib/bimi/lookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bimi/lookup')>()),
  bimiResolver: () => ({ resolve, clear: () => {} }),
}));

import { configManager } from '@/lib/admin/config-manager';
import { GET } from '@/app/api/bimi/route';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000c0000000c0', 'hex');
const verified: BimiIndicator = { status: 'verified', png: PNG, markType: 'verified', organization: 'Brand Ltd', issuer: 'DigiCert, Inc.' };
const selfAsserted: BimiIndicator = { status: 'self-asserted', png: PNG };

let dir: string;
async function setConfig(config: Record<string, unknown>) {
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  await configManager.load();
}
const get = (query: string) => GET(new NextRequest(`https://webmail.example/api/bimi?${query}`));

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bulwark-bimi-'));
  process.env.ADMIN_CONFIG_DIR = dir;
  delete process.env.NO_THIRD_PARTY_TRAFFIC;
  delete process.env.BIMI_REQUIRE_CERTIFICATE;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ADMIN_CONFIG_DIR;
});
beforeEach(async () => {
  resolve.mockReset();
  await setConfig({});
});

describe('/api/bimi', () => {
  it('answers the logo as a PNG that cannot run anything', async () => {
    resolve.mockResolvedValue(selfAsserted);
    const res = await get('domain=brand.org');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-bulwark-bimi')).toBe('self-asserted');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
    expect(resolve).toHaveBeenCalledWith('brand.org');
  });

  it('answers the 1x1 placeholder when there is no logo', async () => {
    resolve.mockResolvedValue(null);
    const res = await get('domain=brand.org');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-bulwark-bimi')).toBe('missing');
    const bytes = Buffer.from(await res.arrayBuffer());
    // PNG width and height from the IHDR chunk.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1, 1]);
  });

  it('drops self-published logos when the admin requires a mark certificate', async () => {
    await setConfig({ bimiRequireCertificate: true });
    resolve.mockResolvedValue(selfAsserted);
    expect((await get('domain=brand.org')).headers.get('x-bulwark-bimi')).toBe('missing');
    expect(await (await get('domain=brand.org&format=json')).json()).toEqual({ status: 'none' });

    resolve.mockResolvedValue(verified);
    expect((await get('domain=brand.org')).headers.get('x-bulwark-bimi')).toBe('verified');
  });

  it('describes what backs the logo in JSON', async () => {
    resolve.mockResolvedValue(verified);
    expect(await (await get('domain=brand.org&format=json')).json()).toEqual({
      status: 'verified', markType: 'verified', organization: 'Brand Ltd', issuer: 'DigiCert, Inc.',
    });
  });

  it('refuses a missing or local domain without a lookup', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('domain=localhost')).status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  });
});
