import { describe, it, expect, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';

type Call = [string, Record<string, unknown>, string];

const PROPERTY = 'header:Authentication-Results:all';
// Raw and folded, as Stalwart 0.16 and 1.0 return the header property.
const OWN = ' mx.example.org;\r\n\tdmarc=fail (p=reject) header.from=paypal.com;\r\n\tspf=fail smtp.mailfrom=paypal.com';
const FORGED = ' mx.paypal.com; dmarc=pass header.from=paypal.com';

function recordingClient() {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, { accountId: 'me', capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInGet: 50 } } });
  const gets: Record<string, unknown>[] = [];
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (calls: Call[]) => ({
      methodResponses: calls.map(([method, args, id]) => {
        if (method === 'Email/query') return ['Email/query', { ids: ['m1', 'm2'], total: 2, position: 0 }, id];
        if (method === 'Thread/get') return ['Thread/get', { list: [{ id: 't1', emailIds: ['m1', 'm2'] }] }, id];
        if (method === 'Email/get') {
          gets.push(args);
          return ['Email/get', {
            list: [
              { id: 'm1', threadId: 't1', receivedAt: '2026-10-29T10:00:00Z', from: [{ email: 'billing@paypal.com' }], [PROPERTY]: [OWN, FORGED] },
              { id: 'm2', threadId: 't2', receivedAt: '2026-10-29T09:00:00Z', from: [{ email: 'ann@example.com' }], [PROPERTY]: [] },
            ],
          }, id];
        }
        return [method, {}, id];
      }),
    }));
  return { client, gets };
}

// #1439: list avatars need the sender check without fetching each message.
describe('list requests', () => {
  const fetches: Array<[string, (client: JMAPClient) => Promise<Array<Record<string, unknown>>>]> = [
    ['getSomeEmails', (c) => c.getSomeEmails(['m1', 'm2']) as never],
    ['getEmails', async (c) => (await c.getEmails('inbox')).emails as never],
    ['searchEmails', async (c) => (await c.searchEmails('paypal')).emails as never],
    ['advancedSearchEmails', async (c) => (await c.advancedSearchEmails({ text: 'paypal' })).emails as never],
    ['getThreadEmails', (c) => c.getThreadEmails('t1') as never],
  ];

  it.each(fetches)('%s parses Authentication-Results from the header property', async (_name, fetch) => {
    const { client, gets } = recordingClient();
    const emails = await fetch(client);
    expect(gets.some((args) => (args.properties as string[]).includes(PROPERTY))).toBe(true);

    const forged = emails.find((e) => e.id === 'm1')!;
    // The topmost header is the receiving server's; the one below it is the sender's claim.
    expect(forged.authenticationResults).toMatchObject({ dmarc: { result: 'fail' } });
    expect(forged).not.toHaveProperty(PROPERTY);

    const plain = emails.find((e) => e.id === 'm2')!;
    expect(plain.authenticationResults).toBeUndefined();
    expect(plain).not.toHaveProperty(PROPERTY);
  });
});
