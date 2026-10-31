import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapSession } from './fixtures/jmap-session';

// #1173: moving many folders at once goes through one Mailbox/set per
// maxObjectsInSet chunk, and a refused folder doesn't fail the others.

describe('JMAPClient.updateMailboxes', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function connectedClient(maxObjectsInSet?: number): Promise<JMAPClient> {
    fetchSpy.mockResolvedValueOnce(Response.json(jmapSession({
      accountCapabilities: {},
      serverCapabilities: { 'urn:ietf:params:jmap:core': maxObjectsInSet ? { maxObjectsInSet } : {} },
    })));
    const client = JMAPClient.withBearer('https://mail.example.com', 'token123', 'user@test.com');
    await client.connect();
    fetchSpy.mockReset();
    return client;
  }

  const sentUpdates = (): Record<string, unknown>[] => fetchSpy.mock.calls.map((call: unknown[]) => {
    const init = call[1] as RequestInit;
    const [name, args] = JSON.parse(init.body as string).methodCalls[0];
    expect(name).toBe('Mailbox/set');
    return args.update as Record<string, unknown>;
  });

  it('sends every update in one Mailbox/set and returns the refused ids', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(Response.json({
      methodResponses: [
        ['Mailbox/set', { updated: { a: null, c: null }, notUpdated: { b: { type: 'invalidProperties' } } }, '0'],
      ],
    }));

    const failed = await client.updateMailboxes({
      a: { parentId: 'old' },
      b: { parentId: 'old' },
      c: { parentId: 'old' },
    });

    expect(failed).toEqual({ b: 'invalidProperties' });
    expect(sentUpdates()).toEqual([
      { a: { parentId: 'old' }, b: { parentId: 'old' }, c: { parentId: 'old' } },
    ]);
  });

  it('splits the updates by maxObjectsInSet', async () => {
    const client = await connectedClient(2);
    fetchSpy.mockImplementation(async () => Response.json({
      methodResponses: [['Mailbox/set', { updated: {} }, '0']],
    }));

    const failed = await client.updateMailboxes({
      a: { parentId: null },
      b: { parentId: null },
      c: { parentId: null },
    });

    expect(failed).toEqual({});
    expect(sentUpdates().map(u => Object.keys(u))).toEqual([['a', 'b'], ['c']]);
  });

  it('throws when the server rejects the whole call', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(Response.json({
      methodResponses: [['error', { type: 'forbidden' }, '0']],
    }));

    await expect(client.updateMailboxes({ a: { parentId: null } })).rejects.toThrow('forbidden');
  });
});
