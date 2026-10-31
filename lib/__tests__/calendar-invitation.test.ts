import { describe, it, expect } from 'vitest';
import {
  findCalendarAttachment,
  getInvitationActorSummary,
  getInvitationMethod,
  getInvitationTrustAssessment,
  formatEventSummary,
  findParticipantByEmail,
} from '../calendar-invitation';
import type { Email, CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'e1',
    threadId: 't1',
    mailboxIds: { inbox: true },
    keywords: {},
    size: 1024,
    receivedAt: '2026-02-17T10:00:00Z',
    hasAttachment: false,
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<CalendarParticipant> = {}): CalendarParticipant {
  return {
    '@type': 'Participant',
    name: 'Test',
    email: 'test@example.com',
    calendarAddress: null,
    description: null,
    sendTo: null,
    kind: 'individual',
    roles: { attendee: true },
    participationStatus: 'needs-action',
    participationComment: null,
    expectReply: false,
    scheduleAgent: 'server',
    scheduleForceSend: false,
    scheduleId: null,
    scheduleSequence: 0,
    scheduleStatus: null,
    scheduleUpdated: null,
    invitedBy: null,
    delegatedTo: null,
    delegatedFrom: null,
    memberOf: null,
    locationId: null,
    language: null,
    links: null,
    ...overrides,
  };
}

describe('findCalendarAttachment', () => {
  it('finds attachment by MIME type text/calendar', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'b1', size: 500, type: 'text/calendar', name: 'invite.ics' },
      ],
      hasAttachment: true,
    });
    const result = findCalendarAttachment(email);
    expect(result).toBeTruthy();
    expect(result!.blobId).toBe('b1');
  });

  it('finds attachment by application/ics type', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'b2', size: 500, type: 'application/ics', name: 'event.ics' },
      ],
      hasAttachment: true,
    });
    expect(findCalendarAttachment(email)?.blobId).toBe('b2');
  });

  it('finds attachment by .ics file extension', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'b3', size: 500, type: 'application/octet-stream', name: 'meeting.ics' },
      ],
      hasAttachment: true,
    });
    expect(findCalendarAttachment(email)?.blobId).toBe('b3');
  });

  it('finds attachment by .ical file extension', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'b4', size: 500, type: 'application/octet-stream', name: 'meeting.ical' },
      ],
      hasAttachment: true,
    });
    expect(findCalendarAttachment(email)?.blobId).toBe('b4');
  });

  it('returns null when no calendar attachment exists', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'b5', size: 500, type: 'application/pdf', name: 'doc.pdf' },
      ],
      hasAttachment: true,
    });
    expect(findCalendarAttachment(email)).toBeNull();
  });

  it('returns null when attachments is undefined', () => {
    const email = makeEmail();
    expect(findCalendarAttachment(email)).toBeNull();
  });

  it('finds attachment when text/calendar includes MIME parameters', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'b6', size: 500, type: 'text/calendar; method=REQUEST; charset=UTF-8' },
      ],
      hasAttachment: true,
    });
    expect(findCalendarAttachment(email)?.blobId).toBe('b6');
  });

  it('detects text/calendar in textBody parts', () => {
    const email = makeEmail({
      textBody: [
        { partId: 'p1', blobId: 'tb1', size: 300, type: 'text/calendar' },
      ],
    });
    const result = findCalendarAttachment(email);
    expect(result).toBeTruthy();
    expect(result!.blobId).toBe('tb1');
  });

  it('detects nested text/calendar body parts inside multipart structures', () => {
    const email = makeEmail({
      textBody: [
        {
          partId: 'root',
          blobId: 'rootBlob',
          size: 100,
          type: 'multipart/alternative',
          subParts: [
            { partId: 'plain', blobId: 'plainBlob', size: 50, type: 'text/plain' },
            { partId: 'ical', blobId: 'tbNested', size: 300, type: 'text/calendar; method=REQUEST; charset=UTF-8' },
          ],
        },
      ],
    });
    expect(findCalendarAttachment(email)?.blobId).toBe('tbNested');
  });

  it('prioritizes attachments over textBody', () => {
    const email = makeEmail({
      attachments: [
        { partId: '1', blobId: 'att1', size: 500, type: 'text/calendar', name: 'invite.ics' },
      ],
      textBody: [
        { partId: 'p1', blobId: 'tb1', size: 300, type: 'text/calendar' },
      ],
      hasAttachment: true,
    });
    expect(findCalendarAttachment(email)?.blobId).toBe('att1');
  });
});

describe('getInvitationMethod', () => {
  it('detects cancel when status is cancelled', () => {
    expect(getInvitationMethod({ status: 'cancelled' })).toBe('cancel');
  });

  it('detects request from MIME Content-Type method parameter', () => {
    const event: Partial<CalendarEvent> = {};
    const email = makeEmail({
      headers: {
        'Content-Type': 'text/calendar; method=REQUEST; charset=UTF-8',
      },
    });
    expect(getInvitationMethod(event, { email })).toBe('request');
  });

  it('detects reply from attachment MIME method parameter', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        att: makeParticipant({ participationStatus: 'accepted' }),
      },
    };
    expect(getInvitationMethod(event, {
      attachment: { type: 'text/calendar; method=REPLY; charset=UTF-8' },
    })).toBe('reply');
  });

  it('detects publish, add, refresh, counter, and declinecounter from MIME parameters', () => {
    const event: Partial<CalendarEvent> = {};
    expect(getInvitationMethod(event, { attachment: { type: 'text/calendar; method=PUBLISH' } })).toBe('publish');
    expect(getInvitationMethod(event, { attachment: { type: 'text/calendar; method=ADD' } })).toBe('add');
    expect(getInvitationMethod(event, { attachment: { type: 'text/calendar; method=REFRESH' } })).toBe('refresh');
    expect(getInvitationMethod(event, { attachment: { type: 'text/calendar; method=COUNTER' } })).toBe('counter');
    expect(getInvitationMethod(event, { attachment: { type: 'text/calendar; method=DECLINECOUNTER' } })).toBe('declinecounter');
  });

  it('does not treat text/calendar without method as iMIP metadata', () => {
    const event: Partial<CalendarEvent> = {};
    const email = makeEmail({
      headers: {
        'Content-Type': 'text/calendar; charset=UTF-8',
      },
    });
    expect(getInvitationMethod(event, { email })).toBe('unknown');
  });

  it('detects request when participants have organizer role', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, name: 'Organizer' }),
        att: makeParticipant({ roles: { attendee: true }, name: 'Attendee' }),
      },
    };
    expect(getInvitationMethod(event)).toBe('request');
  });

  it('detects request with chair role', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { chair: true }, name: 'Chair' }),
      },
    };
    expect(getInvitationMethod(event)).toBe('request');
  });

  it('returns unknown when no participants', () => {
    expect(getInvitationMethod({})).toBe('unknown');
  });

  it('returns unknown when participants have no organizer', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        att: makeParticipant({ roles: { attendee: true } }),
      },
    };
    expect(getInvitationMethod(event)).toBe('unknown');
  });

  it('infers reply when attendee status is present without an organizer', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        att: makeParticipant({ roles: { attendee: true }, participationStatus: 'accepted' }),
      },
    };
    expect(getInvitationMethod(event)).toBe('reply');
  });
});

describe('getInvitationActorSummary', () => {
  it('picks the attendee as actor for reply-like methods', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com', name: 'Organizer' }),
        att: makeParticipant({
          roles: { attendee: true },
          email: 'alice@example.com',
          name: 'Alice',
          participationStatus: 'accepted',
          participationComment: 'Works for me',
        }),
      },
    };

    expect(getInvitationActorSummary(event, 'reply')).toMatchObject({
      role: 'attendee',
      name: 'Alice',
      participationStatus: 'accepted',
      participationComment: 'Works for me',
    });
  });

  it('picks the organizer as actor for declinecounter', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com', name: 'Organizer' }),
        att: makeParticipant({
          roles: { attendee: true },
          email: 'alice@example.com',
          name: 'Alice',
          participationStatus: 'tentative',
        }),
      },
    };

    expect(getInvitationActorSummary(event, 'declinecounter')).toMatchObject({
      role: 'organizer',
      name: 'Organizer',
      email: 'organizer@example.com',
    });
  });
});

describe('formatEventSummary', () => {
  it('extracts title from event', () => {
    const summary = formatEventSummary({ title: 'Team Sync' });
    expect(summary.title).toBe('Team Sync');
  });

  it('extracts location from event', () => {
    const summary = formatEventSummary({
      locations: { loc1: { '@type': 'Location', name: 'Room A', description: null, locationTypes: null, coordinates: null, timeZone: null, links: null, relativeTo: null } },
    });
    expect(summary.location).toBe('Room A');
  });

  it('extracts organizer info', () => {
    const summary = formatEventSummary({
      participants: {
        org: makeParticipant({ roles: { owner: true }, name: 'Alice', email: 'alice@example.com' }),
        att: makeParticipant({ roles: { attendee: true }, name: 'Bob' }),
      },
    });
    expect(summary.organizer).toBe('Alice');
    expect(summary.organizerEmail).toBe('alice@example.com');
    expect(summary.attendeeCount).toBe(1);
  });

  it('handles missing data gracefully', () => {
    const summary = formatEventSummary({});
    expect(summary.title).toBe('');
    expect(summary.start).toBeNull();
    expect(summary.end).toBeNull();
    expect(summary.location).toBeNull();
    expect(summary.organizer).toBeNull();
    expect(summary.attendeeCount).toBe(0);
  });

  it('computes end from start + duration', () => {
    const summary = formatEventSummary({
      start: '2026-02-17T10:00:00',
      duration: 'PT1H30M',
    });
    expect(summary.start).toBe('2026-02-17T10:00:00');
    expect(summary.end).toBe('2026-02-17T11:30:00');
  });

  it('uses utcStart and utcEnd when available', () => {
    const summary = formatEventSummary({
      utcStart: '2026-02-17T15:00:00Z',
      utcEnd: '2026-02-17T16:00:00Z',
      start: '2026-02-17T10:00:00',
    });
    expect(summary.start).toBe('2026-02-17T15:00:00Z');
    expect(summary.end).toBe('2026-02-17T16:00:00Z');
    expect(summary.isAllDay).toBe(false);
  });

  it('prefers local start over utcStart for all-day events', () => {
    const summary = formatEventSummary({
      utcStart: '2026-03-16T00:00:00Z',
      utcEnd: '2026-03-17T00:00:00Z',
      start: '2026-03-16T00:00:00',
      showWithoutTime: true,
    });
    expect(summary.start).toBe('2026-03-16T00:00:00');
    expect(summary.end).toBe('2026-03-17T00:00:00Z');
    expect(summary.isAllDay).toBe(true);
  });

  it('computes all-day end in local format when utcEnd is missing', () => {
    const summary = formatEventSummary({
      start: '2026-03-16T00:00:00',
      duration: 'P1D',
      showWithoutTime: true,
    });
    expect(summary.start).toBe('2026-03-16T00:00:00');
    expect(summary.end).toBe('2026-03-17T00:00:00');
    expect(summary.isAllDay).toBe(true);
  });

  it('infers all-day summaries from midnight-to-midnight events without the flag', () => {
    const summary = formatEventSummary({
      start: '2026-03-16T00:00:00',
      duration: 'PT24H',
    });
    expect(summary.start).toBe('2026-03-16T00:00:00');
    expect(summary.end).toBe('2026-03-17T00:00:00');
    expect(summary.isAllDay).toBe(true);
  });

  it('returns local format end for timed events with local start', () => {
    const summary = formatEventSummary({
      start: '2026-02-17T10:00:00',
      duration: 'PT1H30M',
    });
    expect(summary.end).toBe('2026-02-17T11:30:00');
  });
});

describe('getInvitationTrustAssessment', () => {
  it('warns when mail authentication fails', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com' }),
      },
    };

    const result = getInvitationTrustAssessment(event, makeEmail({
      from: [{ email: 'organizer@example.com' }],
      authenticationResults: {
        dmarc: { result: 'fail', domain: 'example.com', policy: 'reject' },
      },
    }), 'request');

    expect(result.level).toBe('warning');
    expect(result.reason).toBe('authentication_failed');
  });

  it('warns when sender and organizer differ without verified authentication', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com' }),
      },
    };

    const result = getInvitationTrustAssessment(event, makeEmail({
      from: [{ email: 'calendar-bot@example.net' }],
    }), 'request');

    expect(result.level).toBe('warning');
    expect(result.reason).toBe('sender_mismatch_unverified');
  });

  it('shows caution when sender and organizer differ but authentication passed', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com' }),
      },
    };

    const result = getInvitationTrustAssessment(event, makeEmail({
      from: [{ email: 'assistant@example.com' }],
      authenticationResults: {
        dkim: { result: 'pass', domain: 'example.com', selector: 'mail' },
      },
    }), 'request');

    expect(result.level).toBe('caution');
    expect(result.reason).toBe('sender_mismatch');
  });

  it('shows caution when an invitation has no verified authentication', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com' }),
      },
    };

    const result = getInvitationTrustAssessment(event, makeEmail({
      from: [{ email: 'organizer@example.com' }],
    }), 'request');

    expect(result.level).toBe('caution');
    expect(result.reason).toBe('authentication_missing');
  });

  it('returns trusted when sender matches organizer and authentication passed', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        org: makeParticipant({ roles: { owner: true }, email: 'organizer@example.com' }),
      },
    };

    const result = getInvitationTrustAssessment(event, makeEmail({
      from: [{ email: 'organizer@example.com' }],
      authenticationResults: {
        spf: { result: 'pass', domain: 'example.com', ip: '203.0.113.5' },
      },
    }), 'request');

    expect(result.level).toBe('trusted');
    expect(result.reason).toBeNull();
  });
});

describe('findParticipantByEmail', () => {
  it('finds participant by direct email match', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        p1: makeParticipant({ email: 'alice@example.com', name: 'Alice' }),
      },
    };
    const result = findParticipantByEmail(event, 'alice@example.com');
    expect(result).toBeTruthy();
    expect(result!.id).toBe('p1');
    expect(result!.participant.name).toBe('Alice');
  });

  it('matches case-insensitively', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        p1: makeParticipant({ email: 'Alice@Example.COM' }),
      },
    };
    expect(findParticipantByEmail(event, 'alice@example.com')).toBeTruthy();
  });

  it('finds participant by sendTo mailto', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        p1: makeParticipant({ email: '', sendTo: { imip: 'mailto:bob@example.com' } }),
      },
    };
    const result = findParticipantByEmail(event, 'bob@example.com');
    expect(result).toBeTruthy();
    expect(result!.id).toBe('p1');
  });

  it('returns null when no match', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        p1: makeParticipant({ email: 'alice@example.com' }),
      },
    };
    expect(findParticipantByEmail(event, 'unknown@example.com')).toBeNull();
  });

  it('returns null with no participants', () => {
    expect(findParticipantByEmail({}, 'test@example.com')).toBeNull();
  });

  it('returns null with empty email', () => {
    const event: Partial<CalendarEvent> = {
      participants: {
        p1: makeParticipant({ email: 'alice@example.com' }),
      },
    };
    expect(findParticipantByEmail(event, '')).toBeNull();
  });
});
