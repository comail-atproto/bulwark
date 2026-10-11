import { describe, expect, it, vi } from 'vitest';
import { eventToICS } from '../calendar-ics-export';
import { SpaceCalendarAdapter } from '../jmap/space-calendar-adapter';

const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const member = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

async function spaceEvent(overrides: Record<string, unknown> = {}) {
  const record = {
    id: 'event-one', uid: 'meeting@example.test', calendarId: 'calendar-one',
    title: 'Private meeting', description: 'Synthetic event',
    start: '2026-10-08T10:00:00', timeZone: 'America/New_York', duration: 'PT1H',
    showWithoutTime: false, status: 'confirmed', revisionId: 'revision-one',
    actorDID: member, ownerDID: owner,
    participants: {
      [owner]: { did: owner, participationStatus: 'accepted' },
      [member]: { did: member, participationStatus: 'tentative', isCurrentUser: true },
    },
    ...overrides,
  };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ events: [record] }));
  const [event] = await new SpaceCalendarAdapter(() => 0, fetcher).getEvents(
    '2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z',
  );
  return event;
}

const unfold = (value: string) => value.replace(/\r\n[ \t]/g, '');

describe('calendar ICS export', () => {
  it('exports Space events without asking an importing server to schedule them', async () => {
    const ics = unfold(eventToICS(await spaceEvent()));
    expect(ics).not.toContain('\r\nMETHOD:');
    const addresses = ics.split('\r\n').filter((line) => /^(ORGANIZER|ATTENDEE)[;:]/.test(line));
    expect(addresses).toHaveLength(3);
    for (const address of addresses) {
      expect(address).toContain(';SCHEDULE-AGENT=NONE');
    }
  });

  it('preserves Space identities, both responses and the canonical schedule', async () => {
    const event = await spaceEvent();
    const ics = unfold(eventToICS(event));
    expect(ics).toContain(`ORGANIZER;SCHEDULE-AGENT=NONE:${owner}\r\n`);
    expect(ics).toContain(`ATTENDEE;CN="${owner}";SCHEDULE-AGENT=NONE;PARTSTAT=ACCEPTED:${owner}\r\n`);
    expect(ics).toContain(`ATTENDEE;CN="${member}";SCHEDULE-AGENT=NONE;PARTSTAT=TENTATIVE:${member}\r\n`);
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261008T100000\r\n');
    expect(ics).toContain('DURATION:PT1H\r\n');
    expect(ics).toContain('CLASS:PRIVATE\r\n');
    expect(ics).not.toContain('mailto:');
    expect(ics).not.toContain('LAST-MODIFIED:');
    expect(event.spaceRevisionId).toBe('revision-one');
    expect(event.updated).toBeNull();
  });

  it('preserves bounded recurrence, excluded occurrences and cancellation after reconstruction', async () => {
    const canonical = {
      status: 'cancelled', recurrenceRules: [{ frequency: 'weekly', count: 3 }],
      recurrenceOverrides: { '2026-10-15T10:00:00': { excluded: true } },
    };
    const original = unfold(eventToICS(await spaceEvent(canonical)));
    const recovered = unfold(eventToICS(await spaceEvent(canonical)));
    const semantic = (ics: string) => ics.replace(/^DTSTAMP:.*\r\n/m, '');
    expect(semantic(recovered)).toBe(semantic(original));
    expect(recovered).toContain('RRULE:FREQ=WEEKLY;COUNT=3\r\n');
    expect(recovered).toContain('EXDATE;TZID=America/New_York:20261015T100000\r\n');
    expect(recovered).toContain('STATUS:CANCELLED\r\n');
  });

  it('exports the Space owner before any participant has responded', async () => {
    const ics = unfold(eventToICS(await spaceEvent({ participants: null })));
    expect(ics).toContain(`ORGANIZER;SCHEDULE-AGENT=NONE:${owner}\r\n`);
    expect(ics).not.toContain('ATTENDEE');
  });

  it('quotes participant names and folds UTF-8 without damaging the text', async () => {
    const title = '📅é'.repeat(40);
    const event = await spaceEvent({ title, participants: {
      [member]: { did: member, name: 'Bob: "Calendar" ^\nGuest', participationStatus: 'tentative' },
    } });
    const ics = eventToICS(event);
    expect(unfold(ics)).toContain('CN="Bob: ^\'Calendar^\' ^^^nGuest"');
    expect(unfold(ics)).toContain(`SUMMARY:${title}\r\n`);
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('retains email organizer and attendee behavior for ordinary JMAP events', async () => {
    const event = await spaceEvent();
    event.source = 'jmap';
    event.updated = '2026-10-08T14:00:00Z';
    event.participants![owner] = { ...event.participants![owner], name: 'Alice', email: 'alice@example.test', roles: { owner: true } };
    event.participants![member] = { ...event.participants![member], name: 'Bob', sendTo: { imip: 'mailto:bob@example.test' }, expectReply: true };
    const ics = unfold(eventToICS(event));
    expect(ics).toContain('METHOD:PUBLISH\r\n');
    expect(ics).not.toContain('SCHEDULE-AGENT=NONE');
    expect(ics).toContain('ORGANIZER;CN="Alice":mailto:alice@example.test\r\n');
    expect(ics).toContain('ATTENDEE;CN="Bob";PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:bob@example.test\r\n');
    expect(ics).toContain('LAST-MODIFIED:20261008T140000Z\r\n');
    expect(ics).not.toContain(`:${owner}\r\n`);
  });
});
