/**
 * Creating calendar collections over CalDAV (through the /api/webdav proxy).
 *
 * Stalwart's JMAP Calendar/set has no way to express the CalDAV
 * supported-calendar-component-set, and the server only accepts that property
 * while a collection is being created - a later PROPPATCH is rejected with
 * "Property cannot be modified". A calendar without it advertises every
 * component type, so sync clients such as DAVx5 offer it to todo apps as well
 * as calendar apps (#760). Creating the collection with MKCALENDAR pins the
 * set; the calendar's other properties are then applied over JMAP as usual.
 */

import { apiFetch } from '@/lib/browser-navigation';
import { getActiveAccountSlotHeaders } from '@/lib/auth/active-account-slot';
import { generateUUID } from '@/lib/utils';
import type { CalendarComponentType } from '@/lib/jmap/types';

/** What a plain "calendar" holds unless the user asks for tasks. */
export const DEFAULT_CALENDAR_COMPONENTS: readonly CalendarComponentType[] = ['VEVENT'];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Random path segment for a new collection. Stalwart's own JMAP create uses a
 * random alphanumeric name too; the display name lives in a separate property,
 * so the segment never needs to be human readable.
 */
export function newCalendarCollectionName(): string {
  return generateUUID().replace(/-/g, '').slice(0, 16);
}

export function buildMkCalendarBody(displayName: string, components: readonly CalendarComponentType[]): string {
  const comps = components.map((c) => '<C:comp name="' + c + '"/>').join('');
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<D:set><D:prop>' +
    '<D:displayname>' + escapeXml(displayName) + '</D:displayname>' +
    '<C:supported-calendar-component-set>' + comps + '</C:supported-calendar-component-set>' +
    '</D:prop></D:set>' +
    '</C:mkcalendar>';
}

/**
 * MKCALENDAR a collection in the signed-in user's own account. Resolves true
 * when Stalwart reports 201 Created and false for any other status (older
 * server, proxy unavailable, name clash...). Rejects on network failure.
 */
export async function mkCalendarCollection(opts: {
  collectionName: string;
  displayName: string;
  components: readonly CalendarComponentType[];
}): Promise<boolean> {
  const response = await apiFetch('/api/webdav', {
    method: 'POST',
    headers: {
      'X-WebDAV-Method': 'MKCALENDAR',
      'X-WebDAV-Collection': 'cal',
      'X-WebDAV-Path': opts.collectionName,
      'Content-Type': 'application/xml; charset=utf-8',
      ...getActiveAccountSlotHeaders(),
    },
    body: buildMkCalendarBody(opts.displayName, opts.components),
  });
  return response.status === 201;
}
