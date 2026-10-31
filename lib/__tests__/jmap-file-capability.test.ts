import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapSession } from './fixtures/jmap-session';

async function connect(accountCapabilities: Record<string, unknown>, isPersonal = true): Promise<JMAPClient> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(Response.json(jmapSession({ accountCapabilities, isPersonal, serverCapabilities: { 'urn:ietf:params:jmap:filenode': {} } })));
  const client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
  await client.connect();
  fetchSpy.mockReset();
  return client;
}

describe('JMAPClient.supportsFiles (#563 - account-scoped capability)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it.each([
    { name: 'personal account advertises files', capabilities: { 'urn:ietf:params:jmap:filenode': {} }, personal: true, supported: true },
    { name: 'personal account omits files despite server advertisement', capabilities: { 'urn:ietf:params:jmap:mail': {} }, personal: true, supported: false },
    { name: 'shared account inherits server support', capabilities: {}, personal: false, supported: true },
  ])('$name', async ({ capabilities, personal, supported }) => {
    const client = await connect(capabilities, personal);
    expect(client.supportsFiles()).toBe(supported);
  });

  it('probeFileNodeSupport does not probe (no network call) when the account is explicitly denied', async () => {
    const client = await connect({ 'urn:ietf:params:jmap:mail': {} });
    fetchSpy.mockClear();
    await expect(client.probeFileNodeSupport()).resolves.toBe(false);
    // Explicit per-account denial must short-circuit before any FileNode/query probe.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
