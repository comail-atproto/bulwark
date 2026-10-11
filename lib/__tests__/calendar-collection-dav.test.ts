import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('@/lib/auth/active-account-slot', () => ({
  getActiveAccountSlotHeaders: () => ({ 'X-JMAP-Cookie-Slot': '2' }),
}));

import {
  buildMkCalendarBody,
  escapeXml,
  mkCalendarCollection,
  newCalendarCollectionName,
} from '@/lib/webdav/calendar-collection';

let fetchSpy: Mock;

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildMkCalendarBody (#760)', () => {
  it('lists every requested component in the CalDAV namespace', () => {
    const body = buildMkCalendarBody('Work', ['VEVENT', 'VTODO']);
    expect(body).toContain('<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">');
    expect(body).toContain('<D:displayname>Work</D:displayname>');
    expect(body).toContain(
      '<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>',
    );
  });

  it('escapes the display name', () => {
    expect(buildMkCalendarBody('R&D <2026> "beta"', ['VEVENT'])).toContain(
      '<D:displayname>R&amp;D &lt;2026&gt; &quot;beta&quot;</D:displayname>',
    );
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });
});

describe('newCalendarCollectionName', () => {
  it('yields a short path-safe segment', () => {
    const name = newCalendarCollectionName();
    expect(name).toMatch(/^[0-9a-f]{16}$/);
    expect(newCalendarCollectionName()).not.toBe(name);
  });
});

describe('mkCalendarCollection', () => {
  it('posts MKCALENDAR through the proxy with the cal collection and account slot', async () => {
    const ok = await mkCalendarCollection({ collectionName: 'abc', displayName: 'Work', components: ['VEVENT'] });
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/webdav$/);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'X-WebDAV-Method': 'MKCALENDAR',
      'X-WebDAV-Collection': 'cal',
      'X-WebDAV-Path': 'abc',
      'Content-Type': 'application/xml; charset=utf-8',
      'X-JMAP-Cookie-Slot': '2',
    });
    expect(init.body).toContain('<C:comp name="VEVENT"/>');
  });

  it('reports anything but 201 as not created', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 405 }));
    await expect(mkCalendarCollection({ collectionName: 'abc', displayName: 'Work', components: ['VEVENT'] })).resolves.toBe(false);
  });
});
