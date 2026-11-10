import { describe, expect, it } from 'vitest';
import { SpaceFileAdapter } from '../space-file-adapter';

const actorDID = 'did:plc:abcdefghijklmnopqrstuvwx';
const inventory = { actorDID, files: [] as Record<string, unknown>[] };

describe('private file authority adapter', () => {
  it('saves folders and empty files through the private authority and reads them back', async () => {
    const source = { ...inventory, files: [] as Record<string, unknown>[] };
    const calls: string[] = [];
    const adapter = new SpaceFileAdapter(() => 0, async (url, init) => {
      calls.push(url);
      if (url.includes('/inventory')) return Response.json(source);
      const put = JSON.parse(String(init?.body));
      const file = { ...put, $type: 'email.atmos.filePersonal.file', revisionId: `revision-${'a'.repeat(64)}`, blob: { cid: 'manifest-test', mimeType: put.mimeType, size: 0 }, size: 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
      delete file.bytes;
      source.files.push(file);
      return Response.json(file);
    });
    const folder = await adapter.createDirectory('Documents', null);
    expect(folder.blobId).toBeNull();
    const staged = await adapter.stage(new File([], 'empty.txt', { type: 'text/plain' }));
    const file = await adapter.create('empty.txt', staged.blobId, staged.type, 0, folder.id);
    expect(file.parentId).toBe(folder.id);
    expect(file.blobId).toMatch(/^space-file:/);
    expect((await adapter.list()).map(node => node.id)).toEqual([folder.id, file.id]);
    expect(calls.every(url => url.startsWith('/api/files/'))).toBe(true);
  });

  it('reuses the complete operation after a lost response and never resurrects a deleted file', async () => {
    const writes: string[] = [];
    const adapter = new SpaceFileAdapter(() => 1, async (url, init) => {
      if (url.includes('/inventory')) return Response.json(inventory);
      writes.push(String(init?.body));
      if (writes.length === 1) throw new Error('lost response');
      const put = JSON.parse(writes[0]);
      return Response.json({ ...put, $type: 'email.atmos.filePersonal.file', revisionId: `revision-${'b'.repeat(64)}`, blob: { cid: 'manifest-test', mimeType: put.mimeType, size: 0 }, size: 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    });
    await expect(adapter.createDirectory('Documents', null)).rejects.toThrow('lost response');
    await expect(adapter.createDirectory('Documents', null)).rejects.toMatchObject({ code: 'conflict' });
    expect(writes[1]).toBe(writes[0]);
  });

  it('finishes an accepted copy after a lost reply even if its source was deleted', async () => {
    const original = { $type: 'email.atmos.filePersonal.file', fileId: `file-${'c'.repeat(64)}`, operationId: `op-${'d'.repeat(64)}`, revisionId: `revision-${'e'.repeat(64)}`, name: 'original.txt', mimeType: 'text/plain', blob: { cid: 'manifest-test', mimeType: 'text/plain', size: 0 }, size: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', parents: [] };
    const source = { actorDID, files: [original] };
    const writes: string[] = [];
    let receipt: typeof original;
    const adapter = new SpaceFileAdapter(() => 0, async (url, init) => {
      if (url.includes('/inventory')) return Response.json(source);
      if (url.includes('/download')) return new Response('');
      writes.push(String(init?.body));
      if (!receipt) {
        receipt = { ...original, ...JSON.parse(writes[0]), revisionId: `revision-${'f'.repeat(64)}` };
        source.files = [receipt];
        throw new Error('lost copy reply');
      }
      return Response.json(receipt);
    });
    await expect(adapter.copy(original.fileId, 'copy.txt', null)).rejects.toThrow('lost copy reply');
    await expect(adapter.copy(original.fileId, 'copy.txt', null)).resolves.toMatchObject({ name: 'copy.txt' });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe(writes[0]);
  });

  it('requires consent and never substitutes another source after provider failure', async () => {
    const adapter = new SpaceFileAdapter(() => 0, async url => url.includes('/authorization')
      ? Response.json({ status: 'authorization_required', authorizationUrl: `https://inbox.comail.at/oauth/files/tickets/${'A'.repeat(43)}` })
      : Response.json({ error: 'authorization_required' }, { status: 409 }));
    await expect(adapter.list()).rejects.toMatchObject({ code: 'authorization_required', authorizationUrl: expect.stringContaining('/oauth/files/tickets/') });
    const failed = new SpaceFileAdapter(() => 0, async () => Response.json({ error: 'not_found' }, { status: 404 }));
    await expect(failed.configured()).rejects.toThrow();
  });

  it('rejects account changes while inventory is in flight', async () => {
    let slot = 0;
    const adapter = new SpaceFileAdapter(() => slot, async () => { slot = 1; return Response.json(inventory); });
    await expect(adapter.list()).rejects.toMatchObject({ code: 'account_changed' });
  });
});
