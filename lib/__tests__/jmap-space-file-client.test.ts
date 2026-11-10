import { describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { SpaceFileAdapter, SpaceFileError } from '@/lib/jmap/space-file-adapter';
import { useFileStore } from '@/stores/file-store';

function setup() {
  const client = new JMAPClient('https://mail.test', 'alice@example.test', 'synthetic');
  Object.assign(client, { accountId: 'account-1', accounts: {}, session: { primaryAccounts: {} } });
  const adapter = (client as unknown as { spaceFileAdapter: SpaceFileAdapter }).spaceFileAdapter;
  const jmap = vi.spyOn(client as unknown as { request: () => Promise<unknown> }, 'request').mockRejectedValue(new Error('unexpected Stalwart request'));
  const upload = vi.spyOn(client, 'uploadBlob').mockRejectedValue(new Error('unexpected Stalwart upload'));
  return { client, adapter, jmap, upload };
}

describe('existing Files client with private storage', () => {
  it('does not reinterpret native file names as legacy directory paths', async () => {
    const { client, adapter } = setup();
    vi.spyOn(adapter, 'configured').mockResolvedValue(true);
    vi.spyOn(adapter, 'list').mockResolvedValue([{ id: 'file-test', source: 'space', parentId: null, name: 'reports∕2026', type: 'text/plain', size: 0, blobId: 'space-file:test', created: '', modified: '' }]);
    const create = vi.spyOn(adapter, 'createDirectory');
    const update = vi.spyOn(adapter, 'update');
    useFileStore.getState().initClient(client);
    await expect(useFileStore.getState().migrateLegacyFlatNodes()).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it('routes all file changes through the private authority', async () => {
    const { client, adapter, jmap, upload } = setup();
    vi.spyOn(adapter, 'configured').mockResolvedValue(true);
    const node = { id: 'file-test', parentId: null, name: 'test.txt', type: 'text/plain', size: 0, blobId: 'space-file:test', created: '', modified: '' };
    vi.spyOn(adapter, 'list').mockResolvedValue([node]);
    const stage = vi.spyOn(adapter, 'stage').mockResolvedValue({ blobId: 'space-upload:test', size: 0, type: 'text/plain' });
    const directory = vi.spyOn(adapter, 'createDirectory').mockResolvedValue({ ...node, blobId: null });
    const create = vi.spyOn(adapter, 'create').mockResolvedValue(node);
    const update = vi.spyOn(adapter, 'update').mockResolvedValue(undefined);
    const remove = vi.spyOn(adapter, 'remove').mockResolvedValue(undefined);
    const copy = vi.spyOn(adapter, 'copy').mockResolvedValue(node);
    const download = vi.spyOn(adapter, 'download').mockResolvedValue(new Blob([]));
    expect(await client.probeFileNodeSupport()).toBe(true);
    expect(await client.listAllFileNodes()).toEqual([node]);
    expect(await client.listAllFileNodesAcrossAccounts()).toEqual([node]);
    expect(await client.getFileNodes([node.id])).toEqual([node]);
    await client.uploadFileBlob(new File([], 'test.txt'));
    await client.createFileDirectory('Folder', null);
    await client.createFileNode('test.txt', 'space-upload:test', 'text/plain', 0, null);
    await client.updateFileNode(node.id, { name: 'renamed.txt' });
    await client.updateFileNodes({ [node.id]: { parentId: null } });
    await client.copyFileNode(node.id, 'copy.txt', null);
    await client.destroyFileNodes([node.id]);
    await client.fetchBlob(node.blobId);
    expect(stage).toHaveBeenCalledOnce(); expect(directory).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledOnce(); expect(copy).toHaveBeenCalledOnce(); expect(download).toHaveBeenCalledOnce();
    expect(jmap).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('reports every unattempted batch update after a failure', async () => {
    const { client, adapter } = setup();
    vi.spyOn(adapter, 'configured').mockResolvedValue(true);
    const update = vi.spyOn(adapter, 'update').mockRejectedValue(new SpaceFileError('conflict'));
    const result = await client.updateFileNodes({ first: { name: 'one' }, second: { name: 'two' } });
    expect(result.updated).toEqual([]);
    expect(Object.keys(result.notUpdated)).toEqual(['first', 'second']);
    expect(update).toHaveBeenCalledOnce();
  });

  it('surfaces source failures and denies unqualified sharing and direct blob URLs', async () => {
    const { client, adapter, jmap } = setup();
    vi.spyOn(adapter, 'configured').mockResolvedValue(true);
    await expect(client.setFileNodeShare('file-test', 'bob', null)).rejects.toMatchObject({ code: 'unsupported_sharing' });
    expect(() => client.getBlobDownloadUrl('space-file:test')).toThrow();
    vi.spyOn(adapter, 'configured').mockRejectedValue(new SpaceFileError('files_unavailable'));
    await expect(client.listAllFileNodes()).rejects.toMatchObject({ code: 'files_unavailable' });
    await expect(client.createFileDirectory('Folder', null)).rejects.toMatchObject({ code: 'files_unavailable' });
    expect(jmap).not.toHaveBeenCalled();
  });
});
