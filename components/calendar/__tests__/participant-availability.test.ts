import { describe, expect, it } from 'vitest';
import { availabilityFor } from '../participant-availability';
import type { BusyPeriod } from '@/lib/jmap/types';

const period = (utcStart: string, utcEnd: string, busyStatus: BusyPeriod['busyStatus'] = 'confirmed'): BusyPeriod => ({
  utcStart,
  utcEnd,
  busyStatus,
});

const start = new Date('2026-09-01T10:00:00Z');
const end = new Date('2026-09-01T11:00:00Z');

describe('availabilityFor', () => {
  it('is free without an overlapping busy period', () => {
    expect(availabilityFor([], start, end)).toBe('free');
    // Adjacent periods do not overlap.
    expect(availabilityFor([period('2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z'), period('2026-09-01T11:00:00Z', '2026-09-01T12:00:00Z')], start, end)).toBe('free');
  });

  it('is busy on any confirmed or unclassified overlap', () => {
    expect(availabilityFor([period('2026-09-01T10:30:00Z', '2026-09-01T10:45:00Z')], start, end)).toBe('busy');
    expect(availabilityFor([period('2026-09-01T09:00:00Z', '2026-09-01T12:00:00Z', null)], start, end)).toBe('busy');
    expect(availabilityFor([period('2026-09-01T09:00:00Z', '2026-09-01T12:00:00Z', 'unavailable')], start, end)).toBe('busy');
  });

  it('reports tentative unless a firm conflict exists too', () => {
    expect(availabilityFor([period('2026-09-01T10:30:00Z', '2026-09-01T10:45:00Z', 'tentative')], start, end)).toBe('tentative');
    expect(
      availabilityFor(
        [period('2026-09-01T10:30:00Z', '2026-09-01T10:45:00Z', 'tentative'), period('2026-09-01T10:50:00Z', '2026-09-01T11:30:00Z')],
        start,
        end,
      ),
    ).toBe('busy');
  });
});
