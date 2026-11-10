import { describe, expect, it } from 'vitest';
import { atmoEventOverlapsWindow, normalizeAtmoEventRecord, normalizeAtmoRsvpRecord } from '../record';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const EVENT_RKEY = '3m3z2a2b3c4d5';
const RSVP_RKEY = '3m3z2a2b3c4d6';
const EVENT_URI = `at://${DID}/community.lexicon.calendar.event/${EVENT_RKEY}`;
const CID = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function eventRecord(value: Record<string, unknown> = {}) {
  return {
    uri: EVENT_URI,
    cid: CID,
    value: {
      $type: 'community.lexicon.calendar.event',
      name: 'A public event',
      createdAt: '2026-10-08T09:00:00Z',
      startsAt: '2026-10-12T18:00:00-04:00',
      ...value,
    },
  };
}

describe('atmo calendar record normalization', () => {
  it('preserves AT URI identity, latest CID, source dates, and original atmo link', () => {
    expect(normalizeAtmoEventRecord(eventRecord({
      endsAt: '2026-10-12T20:00:00-04:00',
      description: 'Open discussion',
      locations: [{ name: 'Library' }],
      status: 'community.lexicon.calendar.event#rescheduled',
      mode: 'community.lexicon.calendar.event#hybrid',
    }), 'hosting')).toEqual({
      uri: EVENT_URI,
      cid: CID,
      creatorDid: DID,
      name: 'A public event',
      startsAt: '2026-10-12T18:00:00-04:00',
      endsAt: '2026-10-12T20:00:00-04:00',
      description: 'Open discussion',
      location: 'Library',
      status: 'rescheduled',
      mode: 'hybrid',
      attendance: 'hosting',
      atmoUrl: `https://atmo.rsvp/p/${encodeURIComponent(DID)}/e/${EVENT_RKEY}`,
    });
  });

  it('omits undated events and leaves a missing end absent', () => {
    expect(normalizeAtmoEventRecord(eventRecord({ startsAt: undefined }), 'hosting')).toBeNull();
    const event = normalizeAtmoEventRecord(eventRecord({}), 'going');
    expect(event?.startsAt).toBe('2026-10-12T18:00:00-04:00');
    expect(event).not.toHaveProperty('endsAt');
  });

  it('rejects malformed timezones, reversed spans, and bad source identity', () => {
    expect(() => normalizeAtmoEventRecord(eventRecord({ startsAt: '2026-10-12T18:00:00' }), 'hosting')).toThrow(/timestamp/i);
    expect(() => normalizeAtmoEventRecord(eventRecord({ endsAt: '2026-10-12T17:00:00-04:00' }), 'hosting')).toThrow(/end/i);
    expect(() => normalizeAtmoEventRecord({ ...eventRecord(), uri: EVENT_URI.replace(DID, 'did:plc:somebodyelse') }, 'hosting', EVENT_URI)).toThrow(/identity/i);
  });

  it('preserves cancellation and omitted optional mode without inventing values', () => {
    const event = normalizeAtmoEventRecord(eventRecord({ status: 'community.lexicon.calendar.event#cancelled' }), 'hosting');
    expect(event?.status).toBe('cancelled');
    expect(event).not.toHaveProperty('mode');
  });

  it('decodes the lexicon event status and mode token strings', () => {
    for (const [wire, normalized] of [
      ['scheduled', 'scheduled'],
      ['planned', 'planned'],
      ['postponed', 'postponed'],
      ['rescheduled', 'rescheduled'],
      ['cancelled', 'cancelled'],
    ] as const) {
      expect(normalizeAtmoEventRecord(eventRecord({
        status: `community.lexicon.calendar.event#${wire}`,
      }), 'hosting')?.status).toBe(normalized);
    }
    for (const [wire, normalized] of [
      ['inperson', 'inperson'],
      ['virtual', 'virtual'],
      ['hybrid', 'hybrid'],
    ] as const) {
      expect(normalizeAtmoEventRecord(eventRecord({
        mode: `community.lexicon.calendar.event#${wire}`,
      }), 'hosting')?.mode).toBe(normalized);
    }
    expect(() => normalizeAtmoEventRecord(eventRecord({ status: 'rescheduled' }), 'hosting')).toThrow(/status/i);
    expect(() => normalizeAtmoEventRecord(eventRecord({ mode: 'hybrid' }), 'hosting')).toThrow(/mode/i);
    expect(() => normalizeAtmoEventRecord(eventRecord({
      status: 'community.lexicon.calendar.event#bogus#scheduled',
    }), 'hosting')).toThrow(/status/i);
  });

  it('preserves zero-duration events as points while still rejecting reversed ends', () => {
    const event = normalizeAtmoEventRecord(eventRecord({ endsAt: '2026-10-12T18:00:00-04:00' }), 'hosting');
    expect(event?.endsAt).toBe('2026-10-12T18:00:00-04:00');
    expect(() => normalizeAtmoEventRecord(eventRecord({ endsAt: '2026-10-12T17:59:59-04:00' }), 'hosting')).toThrow(/end/i);
    expect(atmoEventOverlapsWindow(
      { startsAt: '2026-10-12T18:00:00Z', endsAt: '2026-10-12T18:00:00Z' },
      '2026-10-12T18:00:00Z',
      '2026-10-12T19:00:00Z',
    )).toBe(true);
    expect(atmoEventOverlapsWindow(
      { startsAt: '2026-10-12T18:00:00Z', endsAt: '2026-10-12T18:00:00Z' },
      '2026-10-12T17:00:00Z',
      '2026-10-12T18:00:00Z',
    )).toBe(false);
  });

  it('normalizes an RSVP only when it references a public calendar event', () => {
    expect(normalizeAtmoRsvpRecord({
      uri: `at://${DID}/community.lexicon.calendar.rsvp/${RSVP_RKEY}`,
      cid: 'bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: {
        $type: 'community.lexicon.calendar.rsvp',
        subject: { uri: EVENT_URI, cid: CID },
        status: 'community.lexicon.calendar.rsvp#interested',
      },
    })).toEqual({
      uri: `at://${DID}/community.lexicon.calendar.rsvp/${RSVP_RKEY}`,
      cid: 'bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      creatorDid: DID,
      rkey: RSVP_RKEY,
      eventUri: EVENT_URI,
      subjectCid: CID,
      status: 'interested',
    });
    expect(() => normalizeAtmoRsvpRecord({
      uri: `at://${DID}/community.lexicon.calendar.rsvp/${RSVP_RKEY}`,
      cid: CID,
      value: {
        $type: 'community.lexicon.calendar.rsvp',
        subject: { uri: 'at://did:plc:other/app.bsky.feed.post/post1', cid: CID },
        status: 'community.lexicon.calendar.rsvp#going',
      },
    })).toThrow(/event|identity/i);
  });
});
