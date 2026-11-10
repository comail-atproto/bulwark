import { describe, expect, it, vi } from 'vitest';
import { SpaceCalendarAdapter } from '../space-calendar-adapter';
import { canUserRsvp, getEventEditability } from '@/lib/calendar-editability';
import { getUserParticipantId } from '@/lib/calendar-participants';
import type { CalendarEvent } from '../types';

describe('SpaceCalendarAdapter', () => {
  it('subscribes to a public event with an identical retry body and keeps its source identity', async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/calendar/subscriptions?slot=4');
      bodies.push(String(init?.body));
      if (bodies.length === 1) return Response.json({ error: 'provider_unavailable' }, { status: 502 });
      return Response.json({
        id: 'linked-event', uid: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
        calendarId: 'cal_private', revisionId: 'revision-one', title: 'Public meeting', description: '',
        start: '2030-03-04T15:00:00', timeZone: 'UTC', duration: 'PT1H', showWithoutTime: false,
        status: 'confirmed', actorDID: 'did:plc:member', ownerDID: 'did:plc:member',
      });
    });
    const adapter = new SpaceCalendarAdapter(() => 4, fetcher as typeof fetch);
    const source = {
      id: 'atmo:event', source: 'atproto-public', atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      atprotoCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as unknown as CalendarEvent;

    const linked = await adapter.subscribePublicEvent(source);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0])).toMatchObject({ source: { uri: source.atprotoUri, cid: source.atprotoCid } });
    expect(linked).toMatchObject({ source: 'atproto-space', atprotoUri: source.atprotoUri, atprotoCid: source.atprotoCid });
  });

  it('writes an explicit public RSVP against the displayed event revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      uri: 'at://did:plc:member/community.lexicon.calendar.rsvp/3m3z2a2b3c4d5',
      cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher as typeof fetch);
    const event = {
      atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      atprotoCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as CalendarEvent;

    const result = await adapter.rsvpPublicEvent(event, 'interested');

    expect(String(fetcher.mock.calls[0][0])).toBe('/api/calendar/public/rsvps?slot=2');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      eventUri: event.atprotoUri, eventCid: event.atprotoCid, expectedRsvpCid: null, status: 'interested',
    });
    expect(result.uri).toContain('/community.lexicon.calendar.rsvp/');
  });

  it('updates a public RSVP from the actor revision carried by the reader', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      uri: 'at://did:plc:member/community.lexicon.calendar.rsvp/3m3z2a2b3c4d5',
      cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher as typeof fetch);
    const event = {
      atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      atprotoCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      atmoRsvpCid: 'bafyreiprevioussssssssssssssssssssssssssssssssssssssssssssssss',
    } as CalendarEvent;

    await adapter.rsvpPublicEvent(event, 'notgoing');

    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      expectedRsvpCid: event.atmoRsvpCid, status: 'notgoing',
    });
  });

  it('retries the same create precondition and surfaces a conflict after another RSVP wins', async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return Response.json({ error: 'provider_unavailable' }, { status: 503 });
      return Response.json({ error: 'conflict' }, { status: 409 });
    });
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher as typeof fetch);
    const event = {
      atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      atprotoCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as CalendarEvent;

    await expect(adapter.rsvpPublicEvent(event, 'going')).rejects.toMatchObject({ code: 'conflict', status: 409 });

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0])).toMatchObject({ expectedRsvpCid: null, status: 'going' });
  });

  it('starts only the distinct public authorization profile at the public action boundary', async () => {
    const authorizationUrl = 'https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'authorization_required', authorizationProfile: 'owner-public' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: 'authorization_required', authorizationUrl }, { status: 202 }));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher as typeof fetch);
    const event = {
      atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      atprotoCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as CalendarEvent;

    await expect(adapter.rsvpPublicEvent(event, 'going')).rejects.toMatchObject({
      code: 'authorization_required', authorizationUrl,
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/calendar/public/rsvps?slot=2', expect.anything());
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/calendar/public/start?slot=2', expect.objectContaining({
      method: 'POST', body: expect.stringMatching(/^\{"requestId":"[^"]+"\}$/),
    }));
  });

  it('publishes only public event fields from a private Space event', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      uri: 'at://did:plc:member/community.lexicon.calendar.event/3m3z2a2b3c4d5',
      cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }));
    const adapter = new SpaceCalendarAdapter(() => 1, fetcher as typeof fetch);
    const event = {
      source: 'atproto-space', title: 'Open house', description: 'Everyone is welcome',
      utcStart: '2030-03-04T15:00:00.000Z', utcEnd: '2030-03-04T16:00:00.000Z',
      alerts: { private: { trigger: { offset: '-PT15M' } } }, color: '#ff0000', keywords: { private: true },
    } as unknown as CalendarEvent;

    await adapter.publishPublicEvent(event);

    expect(String(fetcher.mock.calls[0][0])).toBe('/api/calendar/public/events?slot=1');
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({
      name: 'Open house', description: 'Everyone is welcome',
      startsAt: '2030-03-04T15:00:00.000Z', endsAt: '2030-03-04T16:00:00.000Z',
    });
    expect(Object.keys(body).sort()).toEqual(['description', 'endsAt', 'name', 'requestId', 'startsAt']);
  });

  it('opens an account-owned calendar without an invited member or fixed share role', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: [{ id: 'cal_private', name: 'My calendar', source: 'atproto-space', myRole: 'owner', initialized: true,
        revisionId: 'calendar-state', policyId: 'calendar-state', members: [], mayShare: false }],
    }), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);
    const [calendar] = await adapter.getCalendars();
    expect(calendar.myRights).toMatchObject({ mayReadItems: true, mayWriteAll: true, mayShare: false });
    expect(calendar.spaceOfferRole).toBeUndefined();
    expect(calendar.shareWith).toBeNull();
  });
  it('keeps an account-owned calendar writable after its first event', async () => {
    const bodies: Array<{ requestId: string; calendarId: string }> = [];
    const fetcher = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ calendars: [{
        id: 'cal_private', name: 'My calendar', source: 'atproto-space', myRole: 'owner', initialized: true,
        revisionId: 'calendar-state', policyId: 'calendar-state', members: [], mayShare: false,
      }] });
      expect(url).toBe('/api/calendar/events?slot=0');
      bodies.push(JSON.parse(init.body as string));
      return Response.json({
        id: `event${bodies.length}`, uid: `uid${bodies.length}`, calendarId: 'cal_private', revisionId: 'rev1',
        title: 'Another event', description: '', start: '2026-10-20T10:00:00', timeZone: 'UTC',
        duration: 'PT1H', showWithoutTime: false, status: 'confirmed',
      });
    });
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);
    const [calendar] = await adapter.getCalendars();
    expect(calendar.myRights).toMatchObject({ mayWriteOwn: true, mayWriteAll: true, mayShare: false });
    const input = { title: 'Another event', start: '2026-10-20T10:00:00', timeZone: 'UTC', duration: 'PT1H' };
    expect((await adapter.createEvent('cal_private', input)).id).toBe('space-event:event1');
    expect((await adapter.createEvent('cal_private', input)).id).toBe('space-event:event2');
    expect(bodies.map(body => body.calendarId)).toEqual(['cal_private', 'cal_private']);
    expect(bodies[0].requestId).not.toBe(bodies[1].requestId);
  });

  it('keeps the shared prototype limited to its initialized event', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ calendars: [{
      id: 'cal_shared', name: 'Shared', source: 'atproto-space', myRole: 'owner', initialized: true,
      revisionId: 'rev1', offerRole: 'editor', members: [],
    }] }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);
    const [calendar] = await adapter.getCalendars();
    expect(calendar.myRights?.mayWriteOwn).toBe(false);
    await expect(adapter.createEvent('cal_shared', { title: 'Another event' }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('binds occurrence RSVP to the original date and maps only explicit actor responses', async () => {
    const stamp = '2026-10-08T10:00:00';
    const record = { id: 'event1', uid: 'uid1', calendarId: 'cal_space1', revisionId: 'rev2',
      title: 'Series', description: '', start: stamp, timeZone: 'America/New_York', duration: 'PT1H',
      showWithoutTime: false, status: 'confirmed', actorDID: 'did:plc:member', ownerDID: 'did:plc:owner',
      participants: { 'did:plc:member': { did: 'did:plc:member', participationStatus: 'accepted', isCurrentUser: true },
        'did:plc:owner': { did: 'did:plc:owner', participationStatus: 'tentative' } },
      recurrenceOverrides: { [stamp]: { title: 'Moved', start: '2026-10-10T12:00:00',
        participants: { 'did:plc:member': { did: 'did:plc:member', participationStatus: 'declined', isCurrentUser: true } } } },
    };
    const fetcher = vi.fn().mockImplementation(() => new Response(JSON.stringify(record), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher as typeof fetch);
    const answered = await adapter.rsvpEvent('event1', 'rev1', 'declined', stamp);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ baseRevision: 'rev1', status: 'declined', recurrenceId: stamp });
    expect(String(fetcher.mock.calls[0][0])).toBe('/api/calendar/events/event1/rsvp?slot=2');
    expect(answered.participants!['did:plc:member'].participationStatus).toBe('accepted');
    expect(answered.recurrenceOverrides![stamp].participants!['did:plc:member']).toMatchObject({
      did: 'did:plc:member', isCurrentUser: true, participationStatus: 'declined', scheduleAgent: 'none',
    });
    expect(answered.recurrenceOverrides![stamp].participants!['did:plc:owner']).toBeUndefined();
    await adapter.updateEvent('event1', 'rev2', { recurrenceOverrides: answered.recurrenceOverrides });
    const written = JSON.parse(fetcher.mock.calls[1][1].body).patch.recurrenceOverrides[stamp];
    expect(written.participants).toEqual({ 'did:plc:member': {
      did: 'did:plc:member', participationStatus: 'declined', isCurrentUser: true,
    } });
    expect(written.title).toBe('Moved');
  });

  it('maps a Space calendar and event to the existing calendar models', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        calendars: [{ id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'editor', initialized: true, revisionId: 'rev-calendar' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        events: [{
          id: 'event1', uid: 'uid1', calendarId: 'cal_space1', title: 'Review', description: '',
          start: '2026-10-08T10:00:00', timeZone: 'America/New_York', duration: 'PT1H',
          showWithoutTime: false, status: 'confirmed',
          participants: { 'did:plc:member': { did: 'did:plc:member', name: 'Member', participationStatus: 'needs-action', isCurrentUser: true } },
          actorDID: 'did:plc:member', ownerDID: 'did:plc:owner',
          revisionId: 'rev-event',
        }],
        revisionId: 'rev-event',
      }), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher as typeof fetch);

    const calendars = await adapter.getCalendars();
    const events = await adapter.getEvents('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z');

    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/calendar/calendars?slot=2',
      '/api/calendar/events?after=2026-10-08T00%3A00%3A00Z&before=2026-10-09T00%3A00%3A00Z&slot=2&includeMetadata=true',
    ]);
    expect(calendars[0]).toMatchObject({ id: 'space:cal_space1', source: 'atproto-space', myRights: { mayWriteAll: true } });
    expect(events[0]).toMatchObject({
      id: 'space-event:event1', originalId: 'event1', source: 'atproto-space',
      calendarIds: { 'space:cal_space1': true }, title: 'Review',
      start: '2026-10-08T10:00:00', timeZone: 'America/New_York', duration: 'PT1H',
      spaceRevisionId: 'rev-event', utcStart: '2026-10-08T14:00:00.000Z',
    });
    expect(getUserParticipantId(events[0], [])).toBe('did:plc:member');
    expect(canUserRsvp(events[0], {
      calendarsById: new Map([[Object.keys(events[0].calendarIds)[0], { myRights: calendars[0].myRights }]]),
      userCalendarAddresses: [],
      isSubscriptionCalendar: () => false,
    })).toBe(true);
    expect(getEventEditability(events[0], {
      calendarsById: new Map([[Object.keys(events[0].calendarIds)[0], { myRights: calendars[0].myRights }]]),
      userCalendarAddresses: [],
      isSubscriptionCalendar: () => false,
    })).toBe('editable');

    const untrustedJmapEvent = { ...events[0], source: 'jmap' as const };
    expect(getUserParticipantId(untrustedJmapEvent, [])).toBeNull();
    expect(canUserRsvp(untrustedJmapEvent, {
      calendarsById: new Map([[Object.keys(untrustedJmapEvent.calendarIds)[0], { myRights: calendars[0].myRights }]]),
      userCalendarAddresses: [],
      isSubscriptionCalendar: () => false,
    })).toBe(false);
  });

  it('refuses unsupported updates before making an HTTP request', async () => {
    const fetcher = vi.fn();
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    await expect(adapter.updateEvent('event1', 'rev-1', { privacy: 'private' } as never))
      .rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose RSVP or edit controls to a viewer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: [{ id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'viewer', initialized: true }],
    }), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    const [calendar] = await adapter.getCalendars();

    expect(calendar.myRights).toMatchObject({ mayReadItems: true, mayRSVP: false, mayWriteAll: false, mayShare: false });
  });

  it('maps the owner-only fixed share role and rejects an owner record without it', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: [{ id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner', initialized: true, offerRole: 'editor' }],
    }), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    const [calendar] = await adapter.getCalendars();
    expect(calendar.spaceOfferRole).toBe('editor');

    const missingRole = new SpaceCalendarAdapter(() => 0, vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: [{ id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner', initialized: true }],
    }), { status: 200 })) as typeof fetch);
    await expect(missingRole.getCalendars()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('exposes the existing share control only to the Space owner', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: [{ id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner', initialized: true, offerRole: 'editor' }],
    }), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    const [calendar] = await adapter.getCalendars();

    expect(calendar.myRights).toMatchObject({ mayShare: true, mayDelete: true, mayWriteAll: true });
  });

  it('lets the owner create the initial event before enabling share or edit actions', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      calendars: [{ id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner', initialized: false, revisionId: null, offerRole: 'editor' }],
    }), { status: 200 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    const [calendar] = await adapter.getCalendars();

    expect(calendar.spaceInitialized).toBe(false);
    expect(calendar.spaceRevisionId).toBeNull();
    expect(calendar.myRights).toMatchObject({ mayWriteOwn: true, mayWriteAll: false, mayShare: false, mayDelete: false });
  });

  it('retries an ambiguous update with the identical idempotency request', async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return Response.json({ error: 'provider_unavailable' }, { status: 502 });
      return Response.json({
        id: 'event1', uid: 'uid1', calendarId: 'cal_space1', title: 'Edited', description: '',
        start: '2026-10-08T10:00:00', timeZone: 'America/New_York', duration: 'PT1H',
        showWithoutTime: false, status: 'confirmed', revisionId: 'rev2',
      });
    });
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    const result = await adapter.updateEvent('event1', 'rev1', { title: 'Edited' });

    expect(result.spaceRevisionId).toBe('rev2');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('creates the first event with the same idempotency body after an ambiguous response', async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(String(init.body));
        if (bodies.length === 1) return Response.json({ error: 'provider_unavailable' }, { status: 502 });
        return Response.json({
          id: 'event1', uid: 'uid-host', calendarId: 'cal_space1', title: 'Review', description: '',
          start: '2026-10-08T10:00:00', timeZone: 'America/New_York', duration: 'PT1H',
          showWithoutTime: false, status: 'confirmed', revisionId: 'rev1',
        });
      }
      return Response.json({ calendars: [{
        id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner',
        initialized: false, revisionId: null, offerRole: 'editor', members: [],
      }] });
    });
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);
    await adapter.getCalendars();

    const result = await adapter.createEvent('cal_space1', {
      title: 'Review', start: '2026-10-08T10:00:00', timeZone: 'America/New_York',
      duration: 'PT1H', showWithoutTime: false, calendarIds: { 'space:cal_space1': true },
      uid: 'browser-generated-uid', status: 'confirmed', freeBusyStatus: 'busy', privacy: 'public',
    });

    expect(result.uid).toBe('uid-host');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0]).event).toMatchObject({ description: '' });
    expect(JSON.parse(bodies[0]).event).not.toHaveProperty('uid');
  });

  it('rejects a share role that differs from the owner-configured offer before sending it', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ calendars: [{
      id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner',
      initialized: true, revisionId: 'rev1', policyId: 'policy1', offerRole: 'editor', members: [],
    }] }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);
    await adapter.getCalendars();
    fetcher.mockClear();

    await expect(adapter.shareCalendar('cal_space1', 'did:plc:guest', {
      mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: false, mayWriteOwn: false,
      mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false,
    })).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps active member roles to the existing sharing control and keeps pending consent ungranted', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ calendars: [{
        id: 'cal_space1', name: 'Project', source: 'atproto-space', myRole: 'owner',
        initialized: true, revisionId: 'rev1', policyId: 'policy1', offerRole: 'viewer',
        members: [{ did: 'did:plc:guest', principalId: 'did:plc:guest', role: 'viewer', status: 'active' }],
      }] }))
      .mockResolvedValueOnce(Response.json({ status: 'consent_required', member: { did: 'did:plc:guest', role: 'viewer' } }, { status: 202 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);
    const [calendar] = await adapter.getCalendars();

    expect(calendar.shareWith?.['did:plc:guest']).toMatchObject({ mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: false });
    await expect(adapter.shareCalendar('cal_space1', 'did:plc:guest', {
      mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: false, mayWriteOwn: false,
      mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false,
    })).rejects.toMatchObject({ code: 'consent_required', status: 202 });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ principalId: 'did:plc:guest', role: 'viewer' });
  });

  it('loads only the fixed invitee as the sharing principal', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ principals: [
      { id: 'did:plc:guest', type: 'individual', name: 'Guest', email: 'guest@example.test' },
    ] }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    await expect(adapter.getPrincipals()).resolves.toEqual([
      { id: 'did:plc:guest', type: 'individual', name: 'Guest', email: 'guest@example.test' },
    ]);
    expect(fetcher).toHaveBeenCalledWith('/api/calendar/principals?slot=0', expect.anything());
  });

  it('starts only the typed authorization profile and returns the trusted ticket URL for explicit retry', async () => {
    const authorizationUrl = 'https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'authorization_required', authorizationProfile: 'owner-data' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: 'authorization_required', authorizationUrl }, { status: 202 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    await expect(adapter.getCalendars()).rejects.toMatchObject({ code: 'authorization_required', authorizationUrl });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/calendar/calendars?slot=0', expect.anything());
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/calendar/owner/data/start?slot=0', expect.objectContaining({
      method: 'POST',
      body: expect.stringMatching(/^\{"requestId":"[^"]+"\}$/),
    }));
  });

  it('does not turn generic provider outages into authorization starts', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'provider_unavailable' }, { status: 503 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    await expect(adapter.getCalendars()).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects an authorization URL outside the fixed ticket route', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'authorization_required', authorizationProfile: 'owner-data' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: 'authorization_required', authorizationUrl: 'https://evil.test/redirect?next=https://pds.test' }, { status: 202 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    await expect(adapter.getCalendars()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('maps a pending member invitation to a readless existing calendar entry without fetching events', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      error: 'authorization_required', authorizationProfile: 'member-calendar',
      calendar: {
        id: 'cal_fixed', name: 'Project', source: 'atproto-space', initialized: null,
        pendingConsent: true, revisionId: null, policyId: null, myRole: null,
      },
    }, { status: 409 }));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher as typeof fetch);

    const [calendar] = await adapter.getCalendars();
    const events = await adapter.getEvents('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z');

    expect(calendar).toMatchObject({
      id: 'space:cal_fixed', source: 'atproto-space', spaceConsentRequired: true,
      spaceRole: null, spaceInitialized: undefined,
      myRights: { mayReadItems: false, mayWriteAll: false, mayWriteOwn: false, mayRSVP: false, mayShare: false },
    });
    expect(events).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('starts member consent only through the explicit existing selection action', async () => {
    const authorizationUrl = 'https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'authorization_required', authorizationUrl }, { status: 202 }));
    const adapter = new SpaceCalendarAdapter(() => 1, fetcher as typeof fetch);

    await expect(adapter.startAuthorization('member-calendar')).resolves.toBe(authorizationUrl);
    expect(fetcher).toHaveBeenCalledWith('/api/calendar/member/consent/start?slot=1', expect.objectContaining({
      method: 'POST', body: expect.stringMatching(/^\{"requestId":"[^"]+"\}$/),
    }));
  });
});
