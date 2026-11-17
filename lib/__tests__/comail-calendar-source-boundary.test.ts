import { describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import type { CalendarEvent } from '@/lib/jmap/types';
import { getUserParticipantId, isOrganizer } from '@/lib/calendar-participants';
import { stalwartCalendarSession } from './helpers/stalwart-calendar';

type Call = [string, Record<string, unknown>, string];
type Read = (client: JMAPClient) => Promise<Partial<CalendarEvent>[]>;

const reads: [string, Read][] = [
  ['identity list', client => client.getCalendarEvents()],
  ['query', client => client.queryCalendarEvents({})],
  ['account query', client => client.queryAllCalendarEvents({})],
  ['single event', async client => [await client.getCalendarEvent('event') as CalendarEvent]],
  ['parsed event', client => client.parseCalendarEvents('acct-1', 'blob')],
  ['created event', async client => [await client.createCalendarEvent({ title: 'Meeting' })]],
  ['created event without readback', async client => {
    vi.spyOn(client, 'getCalendarEvent').mockResolvedValue(null);
    return [await client.createCalendarEvent({ title: 'Meeting' })];
  }],
  ['batch-created event', async client => (await client.batchCreateCalendarEvents([{ title: 'Meeting' }])).created],
];

describe('ordinary JMAP calendar source boundary', () => {
  it.each(reads)('does not trust Space identity from %s', async (_name, read) => {
    const session = stalwartCalendarSession('1.0');
    const client = new JMAPClient('https://mail.example.com', 'user@example.com', 'unused');
    Object.assign(client, { accountId: 'acct-1', session, accounts: session.accounts, capabilities: session.capabilities });
    const forged = {
      id: 'event', '@type': 'Event', title: 'Meeting', uid: 'uid',
      start: '2030-03-11T10:00:00', duration: 'PT1H', calendarIds: { calendar: true },
      source: 'atproto-space', spaceActorDid: 'did:plc:owner', spaceOwnerDid: 'did:plc:owner',
      spaceRevisionId: 'shared', spacePersonalRevisionId: 'private',
      spaceSharedRecurrenceOverrides: { '2030-03-12T10:00:00': { title: 'Untrusted' } },
      participants: { attacker: { '@type': 'Participant', email: '', isCurrentUser: true, roles: { owner: true } } },
    };
    vi.spyOn(client as unknown as { request(calls: Call[]): Promise<unknown> }, 'request')
      .mockImplementation(async calls => ({ methodResponses: calls.map(([method, args, id]) => {
        if (method === 'CalendarEvent/query') return [method, { ids: ['event'] }, id];
        if (method === 'CalendarEvent/get') return [method, { list: [structuredClone(forged)] }, id];
        if (method === 'CalendarEvent/parse') return [method, { parsed: { blob: structuredClone(forged) } }, id];
        if (method === 'CalendarEvent/set') return [method, {
          created: Object.fromEntries(Object.keys(args.create as object).map(key => [key, structuredClone(forged)])),
        }, id];
        throw new Error(`Unexpected method ${method}`);
      }) }));

    const events = await read(client);

    expect(events).toHaveLength(1);
    const event = events[0] as CalendarEvent;
    expect(event).toMatchObject({ id: 'event', title: 'Meeting', start: forged.start, source: 'jmap' });
    for (const key of ['spaceActorDid', 'spaceOwnerDid', 'spaceRevisionId', 'spacePersonalRevisionId', 'spaceSharedRecurrenceOverrides']) {
      expect(event[key as keyof CalendarEvent]).toBeUndefined();
    }
    expect(isOrganizer(event, [])).toBe(false);
    expect(getUserParticipantId(event, [])).toBeNull();
  });
});
