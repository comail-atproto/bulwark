import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventModal } from '../event-modal';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { useSettingsStore } from '@/stores/settings-store';

const calendars = [{
  id: 'space:calendar', name: 'Shared calendar', source: 'atproto-space',
  myRights: { mayReadItems: true, mayWriteAll: true },
}] as Calendar[];

describe('existing event editor with Space participants', () => {
  const originalTimeZone = useSettingsStore.getState().timeZone;
  afterEach(() => useSettingsStore.setState({ timeZone: originalTimeZone }));

  it('keeps DID participants untouched when saving a title edit', async () => {
    useSettingsStore.setState({ timeZone: 'UTC' });
    const event = {
      id: 'space-event:event', source: 'atproto-space', title: 'Shared event',
      start: '2026-10-08T12:00:00', timeZone: 'America/New_York', duration: 'PT1H',
      utcStart: '2026-10-08T16:00:00.000Z', showWithoutTime: false,
      calendarIds: { 'space:calendar': true }, privacy: 'private',
      participants: {
        'did:plc:member': { did: 'did:plc:member', isCurrentUser: true, name: 'Member', participationStatus: 'needs-action', sendTo: null },
      },
    } as unknown as CalendarEvent;
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EventModal event={event} calendars={calendars} onSave={onSave} onClose={vi.fn()} currentUserEmails={['member@comail.test']} />);

    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Updated title' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Updated title', start: event.start, timeZone: event.timeZone, duration: event.duration, privacy: 'private' });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('participants');
  });
});
