import { describe, expect, it, vi } from 'vitest';
import { SpaceCalendarAdapter } from '../space-calendar-adapter';
import { canUserEditPrivate, canUserRsvp, getEventEditability, publicAtprotoOriginalLink } from '@/lib/calendar-editability';
import { isOrganizer } from '@/lib/calendar-participants';

const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const organizer = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const source = { uri: `at://${organizer}/community.lexicon.calendar.event/3m3z2a2b3c4d5`, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
const record = { id: 'linked-event', uid: source.uri, calendarId: 'private', revisionId: 'revision-one',
  actorDID: owner, ownerDID: owner, title: 'Community meeting', description: '', start: '2030-03-04T10:00:00',
  timeZone: 'UTC', duration: 'PT1H', showWithoutTime: false, status: 'confirmed' };

function adapter(publicSource: unknown, event = record) {
  return new SpaceCalendarAdapter(() => 0, vi.fn().mockResolvedValue(Response.json({
    events: [event], metadata: { [event.id]: { sequence: 0, publicSource } },
  })));
}

describe('PDS copies of public community events', () => {
  it('retains private storage identity and public organizer provenance', async () => {
    const [event] = await adapter(source).getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z');
    expect(event).toMatchObject({ source: 'atproto-space', spaceOwnerDid: owner, spaceActorDid: owner,
      atprotoUri: source.uri, atprotoCid: source.cid, atprotoCreatorDid: organizer });
    expect(isOrganizer(event, [])).toBe(false);
    expect(publicAtprotoOriginalLink(event)).toBe(`https://atmo.rsvp/p/${encodeURIComponent(organizer)}/e/3m3z2a2b3c4d5`);
    const context = { calendarsById: new Map([['space:private', { myRights: { mayReadItems: true, mayReadFreeBusy: true,
      mayWriteAll: true, mayWriteOwn: true, mayRSVP: true, mayUpdatePrivate: true, mayShare: false, mayDelete: true } }]]),
      userCalendarAddresses: [], isSubscriptionCalendar: () => false };
    expect(getEventEditability(event, context)).toBe('read-only');
    expect(canUserRsvp(event, context)).toBe(false);
    expect(canUserEditPrivate(event, context)).toBe(true);
  });

  it.each([null, { ...source, cid: 'not-a-cid' }, { ...source, cid: source.cid.replace('bafyrei', 'bafyre7') },
    { ...source, uri: source.uri.replace(organizer, 'organizer.example') }, { ...source, privateNotes: 'Keep separate' },
  ])('rejects malformed source metadata %j', async invalid => {
    await expect(adapter(invalid).getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects source metadata belonging to another private event', async () => {
    await expect(adapter(source, { ...record, uid: 'unrelated@example.test' }).getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
});
