import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { useCalendarStore } from '../calendar-store';
import { useContactStore } from '../contact-store';
import { setClientLookup } from '../client-registry';

function client(canonical?: CalendarEvent) {
  const calls = {
    updateContact: vi.fn().mockResolvedValue(undefined),
    updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(canonical),
    updateAtprotoSpaceCalendarPrivateEvent: vi.fn().mockResolvedValue(canonical),
  };
  return { api: calls as unknown as IJMAPClient, calls };
}

beforeEach(() => {
  useCalendarStore.getState().clearState();
  useContactStore.getState().clearContacts();
  setClientLookup(() => undefined);
});
afterEach(() => {
  setClientLookup(() => undefined);
  useCalendarStore.getState().clearState();
  useContactStore.getState().clearContacts();
});

describe('owning account required for groupware edits', () => {
  it('creates a calendar while another account is disconnected', async () => {
    const createCalendar = vi.fn(async (calendar: Partial<Calendar>) => ({ ...calendar, id: 'new' }));
    const active = { createCalendar } as unknown as IJMAPClient;
    useCalendarStore.setState({ calendars: [
      { id: 'active', sortOrder: 1 },
      { id: 'stale', localAccountId: 'missing', sortOrder: 99 },
    ] as Calendar[] });

    await useCalendarStore.getState().createCalendar(active, { name: 'New' });

    expect(createCalendar).toHaveBeenCalledWith({ name: 'New', sortOrder: 2 }, undefined, undefined);
  });

  it.each(['connected', 'missing', 'active'] as const)('routes contact edits with a %s owner', async mode => {
    const active = client(); const owner = client();
    const localAccountId = mode === 'active' ? undefined : 'owner';
    const contact = { id: 'owner::same-id', originalId: 'same-id', localAccountId,
      addressBookIds: {}, name: { full: 'Original' } };
    useContactStore.setState({ contacts: [contact] });
    setClientLookup(id => mode === 'connected' && id === 'owner' ? owner.api : undefined);

    const edit = useContactStore.getState().updateContact(active.api, contact.id, { name: { full: 'Changed' } });

    if (mode === 'missing') {
      await expect(edit).rejects.toThrow(/owning account/i);
      expect(active.calls.updateContact).not.toHaveBeenCalled();
      expect(owner.calls.updateContact).not.toHaveBeenCalled();
      expect(useContactStore.getState().contacts).toEqual([contact]);
    } else {
      await expect(edit).resolves.toBe(true);
      const chosen = mode === 'active' ? active : owner;
      const other = mode === 'active' ? owner : active;
      expect(chosen.calls.updateContact).toHaveBeenCalledWith('same-id', { name: { full: 'Changed' } }, undefined);
      expect(other.calls.updateContact).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['shared', 'connected'], ['private', 'connected'], ['shared', 'missing'],
    ['private', 'missing'], ['shared', 'active'], ['private', 'active'],
  ] as const)('routes %s calendar edits with a %s owner', async (audience, mode) => {
    const localAccountId = mode === 'active' ? undefined : 'owner';
    const calendar = { id: 'owner::space:calendar', originalId: 'calendar', source: 'atproto-space',
      localAccountId, myRights: { mayUpdatePrivate: true } } as Calendar;
    const event = { id: 'owner::space-event:same-id', originalId: 'same-id', source: 'atproto-space',
      localAccountId, calendarIds: { [calendar.id]: true }, spaceRevisionId: 'shared-one',
      spacePersonalRevisionId: 'private-one', title: 'Original', color: 'red',
      start: '2030-03-11T10:00:00', duration: 'PT1H' } as CalendarEvent;
    const changes = audience === 'shared' ? { title: 'Changed' } : { color: 'blue' };
    const canonical = { ...event, ...changes };
    const active = client(canonical); const owner = client(canonical);
    useCalendarStore.setState({ calendars: [calendar], events: [event] });
    setClientLookup(id => mode === 'connected' && id === 'owner' ? owner.api : undefined);

    const edit = useCalendarStore.getState().updateEvent(active.api, event.id, changes);

    if (mode === 'missing') {
      await expect(edit).rejects.toThrow(/owning account/i);
      expect(active.calls.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
      expect(active.calls.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
      expect(owner.calls.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
      expect(owner.calls.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
      expect(useCalendarStore.getState().events).toEqual([event]);
    } else {
      await expect(edit).resolves.toBe(true);
      const chosen = mode === 'active' ? active : owner;
      const other = mode === 'active' ? owner : active;
      expect(audience === 'shared' ? chosen.calls.updateAtprotoSpaceCalendarEvent : chosen.calls.updateAtprotoSpaceCalendarPrivateEvent).toHaveBeenCalledOnce();
      expect(other.calls.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
      expect(other.calls.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
    }
  });
});
