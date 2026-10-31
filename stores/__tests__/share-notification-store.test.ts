import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShareNotificationStore } from '../share-notification-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { ShareNotification } from '@/lib/jmap/types';

const notification = (id: string): ShareNotification => ({
  id,
  created: '2026-08-29T10:00:00Z',
  changedBy: { name: 'Alice', email: 'alice@example.com', principalId: 'p1' },
  objectType: 'Mailbox',
  objectAccountId: 'owner',
  objectId: 'f1',
  name: 'Projects',
  oldRights: null,
  newRights: { mayReadItems: true },
});

function makeClient(list: ShareNotification[]) {
  return {
    supportsShareNotifications: () => true,
    getShareNotifications: vi.fn(async () => list),
    destroyShareNotifications: vi.fn(async () => undefined),
  } as unknown as IJMAPClient & { getShareNotifications: ReturnType<typeof vi.fn>; destroyShareNotifications: ReturnType<typeof vi.fn> };
}

describe('share notification store', () => {
  beforeEach(() => {
    useShareNotificationStore.getState().reset();
  });

  it('queues fetched notifications once and acknowledges them on the server', async () => {
    const client = makeClient([notification('n1'), notification('n2')]);
    const store = useShareNotificationStore.getState();

    await store.fetch(client);
    expect(useShareNotificationStore.getState().pending.map((n) => n.id)).toEqual(['n1', 'n2']);

    // A second fetch returning the same ids (not yet destroyed) adds nothing.
    await store.fetch(client);
    expect(useShareNotificationStore.getState().pending).toHaveLength(2);

    await store.acknowledge(client, ['n1']);
    expect(useShareNotificationStore.getState().pending.map((n) => n.id)).toEqual(['n2']);
    expect(client.destroyShareNotifications).toHaveBeenCalledWith(['n1']);
  });

  it('does nothing on a client without share notifications', async () => {
    const client = { supportsShareNotifications: () => false } as unknown as IJMAPClient;
    await useShareNotificationStore.getState().fetch(client);
    expect(useShareNotificationStore.getState().pending).toEqual([]);
  });

  it('coalesces overlapping fetches', async () => {
    const client = makeClient([notification('n1')]);
    const store = useShareNotificationStore.getState();
    await Promise.all([store.fetch(client), store.fetch(client)]);
    expect(client.getShareNotifications).toHaveBeenCalledTimes(1);
    expect(useShareNotificationStore.getState().pending).toHaveLength(1);
  });
});
