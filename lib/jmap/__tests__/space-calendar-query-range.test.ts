import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceCalendarAdapter } from '../space-calendar-adapter';
import * as timezone from '@/lib/timezone';

describe('Space calendar query ranges', () => {
  afterEach(() => vi.restoreAllMocks());

  it('converts grid wall-clock boundaries using the selected display zone', async () => {
    vi.spyOn(timezone, 'getEffectiveTimeZone').mockReturnValue('America/New_York');
    const fetcher = vi.fn<(input: string) => Promise<Response>>().mockResolvedValue(new Response(JSON.stringify({ events: [] })));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher);

    await adapter.getEvents('2026-10-31T00:00:00', '2026-11-02T23:59:59');

    const query = new URL(fetcher.mock.calls[0][0], 'https://comail.test').searchParams;
    expect(query.get('after')).toBe('2026-10-31T04:00:00.000Z');
    expect(query.get('before')).toBe('2026-11-03T04:59:59.000Z');
    expect(query.get('slot')).toBe('2');
  });

  it('preserves UTC and offset boundaries as instants', async () => {
    vi.spyOn(timezone, 'getEffectiveTimeZone').mockReturnValue('Asia/Tokyo');
    const fetcher = vi.fn<(input: string) => Promise<Response>>().mockResolvedValue(new Response(JSON.stringify({ events: [] })));
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher);

    await adapter.getEvents('2026-10-08T00:00:00Z', '2026-10-09T00:00:00+02:00');

    const query = new URL(fetcher.mock.calls[0][0], 'https://comail.test').searchParams;
    expect(query.get('after')).toBe('2026-10-08T00:00:00Z');
    expect(query.get('before')).toBe('2026-10-09T00:00:00+02:00');
  });

  it('rejects invalid wall-clock dates before requesting events', async () => {
    const fetcher = vi.fn<(input: string) => Promise<Response>>();
    const adapter = new SpaceCalendarAdapter(() => 0, fetcher);

    await expect(adapter.getEvents('2026-02-30T00:00:00', '2026-03-02T00:00:00'))
      .rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
