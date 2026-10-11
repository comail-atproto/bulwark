import { describe, expect, it, vi } from 'vitest';
import { SpaceCalendarAdapter } from '../space-calendar-adapter';
import { canUserRsvp, getEventEditability } from '@/lib/calendar-editability';
import { getUserParticipantId } from '@/lib/calendar-participants';

describe('SpaceCalendarAdapter', () => {
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
      '/api/calendar/events?after=2026-10-08T00%3A00%3A00Z&before=2026-10-09T00%3A00%3A00Z&slot=2',
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
