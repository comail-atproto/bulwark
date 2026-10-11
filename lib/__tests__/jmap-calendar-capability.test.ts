import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapSession } from './fixtures/jmap-session';

async function connect(accountCapabilities: Record<string, unknown>, isPersonal = true, serverAdvertises = true, sessionCapabilities: Record<string, unknown> = {}): Promise<JMAPClient> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(Response.json(jmapSession({ accountCapabilities, isPersonal, serverCapabilities: { ...(serverAdvertises ? { 'urn:ietf:params:jmap:calendars': {} } : {}), ...sessionCapabilities } })));
  const client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
  await client.connect();
  fetchSpy.mockReset();
  return client;
}

describe('JMAPClient.supportsCalendars (account-scoped capability)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it.each([
    { name: 'personal account advertises calendars', capabilities: { 'urn:ietf:params:jmap:calendars': {} }, personal: true, advertised: true, supported: true },
    { name: 'personal account omits calendars despite server advertisement', capabilities: { 'urn:ietf:params:jmap:mail': {} }, personal: true, advertised: true, supported: false },
    { name: 'shared account inherits server support', capabilities: {}, personal: false, advertised: true, supported: true },
    { name: 'shared account cannot invent server support', capabilities: {}, personal: false, advertised: false, supported: false },
  ])('$name', async ({ capabilities, personal, advertised, supported }) => {
    const client = await connect(capabilities, personal, advertised);
    expect(client.supportsCalendars()).toBe(supported);
  });
});

describe('calendarUsing (principals:owner declaration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function shareUsing(sessionCapabilities: Record<string, unknown>): Promise<string[]> {
    const client = await connect({ 'urn:ietf:params:jmap:calendars': {} }, true, true, sessionCapabilities);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ methodResponses: [['Calendar/set', { updated: { 'cal-1': null } }, '0']] }),
    );
    await client.setCalendarShare('cal-1', 'principal-1', null);
    return JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).using;
  }

  it('omits principals:owner when the server advertises only base principals', async () => {
    const using = await shareUsing({ 'urn:ietf:params:jmap:principals': {} });
    expect(using).not.toContain('urn:ietf:params:jmap:principals:owner');
  });

  it('declares principals:owner when the server advertises it', async () => {
    const using = await shareUsing({
      'urn:ietf:params:jmap:principals': {},
      'urn:ietf:params:jmap:principals:owner': {},
    });
    expect(using).toContain('urn:ietf:params:jmap:principals:owner');
  });
});
