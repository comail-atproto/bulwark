import { describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { SpaceCalendarAdapter, SpaceCalendarError } from '@/lib/jmap/space-calendar-adapter';
import type { CalendarEvent } from '@/lib/jmap/types';
import { getUserParticipantId, isOrganizer } from '@/lib/calendar-participants';

function makeClient() {
  const client = new JMAPClient('https://mail.example.test', 'member@example.test', 'secret');
  Object.assign(client, {
    accountId: 'acct-1',
    accounts: { 'acct-1': { name: 'Member', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } } },
    capabilities: { 'urn:ietf:params:jmap:calendars': {} },
    session: { accounts: { 'acct-1': {} }, primaryAccounts: {} },
  });
  vi.spyOn(client as unknown as { requestCalendars: (accountId: string) => Promise<unknown> }, 'requestCalendars')
    .mockResolvedValue({ methodResponses: [['Calendar/get', { list: [] }, '0']] });
  vi.spyOn(client as unknown as { getTasksOnlyCalendarIds: () => Promise<Set<string>> }, 'getTasksOnlyCalendarIds')
    .mockResolvedValue(new Set());
  vi.spyOn(client, 'queryCalendarEvents').mockResolvedValue([]);
  return client;
}

describe('Space calendar integration in JMAPClient', () => {
  it('merges configured Space calendars and range events through existing client calls', async () => {
    const client = makeClient();
    const calendar = {
      id: 'space:cal_space1', originalId: 'cal_space1', source: 'atproto-space' as const,
      spaceRole: 'editor' as const, name: 'Project', myRights: {
        mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: true, mayWriteOwn: false,
        mayUpdatePrivate: false, mayRSVP: true, mayShare: false, mayDelete: false,
      },
    };
    const event = {
      id: 'space-event:event1', originalId: 'event1', source: 'atproto-space' as const,
      spaceRevisionId: 'rev-event', calendarIds: { [calendar.id]: true }, start: '2026-10-08T10:00:00',
    } as CalendarEvent;
    const adapter = (client as unknown as { spaceCalendarAdapter: SpaceCalendarAdapter }).spaceCalendarAdapter;
    vi.spyOn(adapter, 'getCalendars').mockResolvedValue([calendar as never]);
    vi.spyOn(adapter, 'getEvents').mockResolvedValue([event]);

    const listed = await client.getAllCalendarsWithFailures();
    const queried = await client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' });

    expect(listed.calendars).toContainEqual(expect.objectContaining({ ...calendar, accountId: 'acct-1', isShared: false }));
    expect(queried).toContainEqual(event);
  });

  it('does not fall back to a JMAP-only result when a configured Space read fails', async () => {
    const client = makeClient();
    const adapter = (client as unknown as { spaceCalendarAdapter: SpaceCalendarAdapter }).spaceCalendarAdapter;
    vi.spyOn(adapter, 'getCalendars').mockResolvedValue([{
      id: 'space:cal_space1', originalId: 'cal_space1', source: 'atproto-space',
      spaceRole: 'viewer', name: 'Project', myRights: {} as never,
    } as never]);
    vi.spyOn(adapter, 'getEvents').mockRejectedValue(new SpaceCalendarError('Unavailable', 'provider_error', 503));

    await expect(client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' }))
      .rejects.toMatchObject({ code: 'provider_error' });
    expect(client.queryCalendarEvents).toHaveBeenCalledTimes(1);
  });

  it('does not trust source or current-user flags returned by an ordinary JMAP event', async () => {
    const client = makeClient();
    const forged = {
      id: 'jmap-event', uid: 'uid1', source: 'atproto-space',
      spaceActorDid: 'did:plc:owner', spaceOwnerDid: 'did:plc:owner',
      start: '2026-10-08T10:00:00', duration: 'PT1H',
      participants: { 'did:plc:attacker': {
        '@type': 'Participant', name: 'Attacker', email: '', did: 'did:plc:attacker', isCurrentUser: true,
        roles: { owner: true }, participationStatus: 'needs-action',
      } },
    } as unknown as CalendarEvent;
    vi.spyOn(client, 'queryCalendarEvents').mockResolvedValue([forged]);
    const adapter = (client as unknown as { spaceCalendarAdapter: SpaceCalendarAdapter }).spaceCalendarAdapter;
    vi.spyOn(adapter, 'getCalendars').mockResolvedValue([]);

    const [event] = await client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' });

    expect(event.source).toBe('jmap');
    expect(event.spaceActorDid).toBeUndefined();
    expect(isOrganizer(event, [])).toBe(false);
    expect(getUserParticipantId(event, [])).toBeNull();
  });
});
