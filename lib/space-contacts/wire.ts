import { contactToWire } from '@/lib/jmap/contact-wire';
import type { ContactCard } from '@/lib/jmap/types';

// The form edits one URI per kind. Keep the other canonical entries and the
// edited entry's metadata when translating those flat fields back to a card.
export function contactToSpaceWire(contact: Partial<ContactCard>, mode: 'create' | 'update', previous: Record<string, unknown> = {}): Record<string, unknown> {
  const flat = { ...contact };
  const fields = [
    ['calendarUri', 'calendars', 'calendar', 'cal', 'Calendar'],
    ['freeBusyUri', 'calendars', 'freeBusy', 'fb', 'Calendar'],
    ['schedulingUri', 'schedulingAddresses', undefined, 'sched', 'SchedulingAddress'],
    ['source', 'directories', 'entry', 'source', 'Directory'],
  ] as const;
  for (const [field] of fields) delete flat[field];
  const wire = contactToWire(flat, mode);
  for (const [field, property, kind, preferredKey, type] of fields) {
    if (!(field in contact)) continue;
    const stored = property in wire ? wire[property] : previous[property];
    const entries = { ...(stored ?? {}) as Record<string, Record<string, unknown>> };
    const selected = Object.keys(entries).find(key => kind === undefined || entries[key]?.kind === kind);
    const uri = contact[field];
    if (uri) {
      let key: string = selected ?? preferredKey;
      for (let suffix = 1; selected === undefined && key in entries; suffix += 1) key = `${preferredKey}${suffix}`;
      entries[key] = selected !== undefined ? { ...entries[key], uri } : { '@type': type, ...(kind ? { kind } : {}), uri };
    } else if (selected !== undefined) delete entries[selected];
    if (Object.keys(entries).length) wire[property] = entries;
    else if (mode === 'update') wire[property] = null;
  }
  return wire;
}
