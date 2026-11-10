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


describe('private reminders in the existing event editor', () => {
  const privateEvent = {
    id: 'space-event:event', source: 'atproto-space', spaceOwnerDid: 'did:plc:owner', title: 'Shared event', description: '',
    start: '2026-10-08T12:00:00', timeZone: 'UTC', duration: 'PT1H', showWithoutTime: false,
    calendarIds: { 'space:calendar': true }, privacy: 'public', freeBusyStatus: 'free', useDefaultAlerts: true, alerts: null,
    participants: { 'did:plc:member': { did: 'did:plc:member', isCurrentUser: true, name: 'Member', participationStatus: 'needs-action', sendTo: null } },
  } as unknown as CalendarEvent;
  const viewer = [{ ...calendars[0], myRights: { ...calendars[0].myRights, mayWriteAll: false, mayUpdatePrivate: true, mayRSVP: false } }];

  it.each([false, true])('lets a viewer edit only their reminders with RSVP rights %s', async rsvp => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EventModal event={privateEvent} calendars={[{ ...viewer[0], myRights: { ...viewer[0].myRights, mayRSVP: rsvp } }]} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    expect(screen.getByPlaceholderText('form.title')).toBeDisabled();
    expect(screen.getByPlaceholderText('form.description')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'events.delete' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Forged shared title' } });
    fireEvent.click(screen.getByRole('button', { name: 'alerts.add' }));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ alerts: { alert1: {
      '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT10M', relativeTo: 'start' },
      action: 'display', acknowledged: null, relatedTo: null,
    } }, useDefaultAlerts: false });
    expect(onSave.mock.calls[0][1]).toBe(false);
  });

  it('stops a pending private save when live rights are revoked', () => {
    const onSave = vi.fn();
    const props = { event: privateEvent, calendars: viewer, onSave, onClose: vi.fn() };
    const { rerender } = render(<EventModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'alerts.add' }));
    rerender(<EventModal {...props} calendars={[{ ...viewer[0], myRights: { ...viewer[0].myRights, mayUpdatePrivate: false } }]} />);
    expect(screen.getByRole('button', { name: 'form.save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'alerts.add' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('preserves other private reminders and acknowledgments when adding one', async () => {
    const alerts = {
      alert1: { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT30M', relativeTo: 'start' },
        action: 'display', acknowledged: '2026-10-01T00:00:00Z', relatedTo: null },
      afterEnd: { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: 'PT1H', relativeTo: 'end' },
        action: 'display', acknowledged: null, relatedTo: null },
    } as CalendarEvent['alerts'];
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EventModal event={{ ...privateEvent, alerts }} calendars={viewer} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'alerts.add' }));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0].alerts;
    expect(saved.alert1).toEqual(alerts!.alert1);
    expect(saved.afterEnd).toEqual(alerts!.afterEnd);
    expect(saved.alert2.trigger.offset).toBe('-PT10M');
    expect(Object.keys(saved)).toHaveLength(3);
  });

  it('does not expose a private editor to an unqualified viewer', () => {
    render(<EventModal event={privateEvent} calendars={[{ ...viewer[0], myRights: { ...viewer[0].myRights, mayUpdatePrivate: false } }]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'events.edit' })).not.toBeInTheDocument();
  });

  it('keeps reminders disabled for a shared editor without private consent', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EventModal event={privateEvent} calendars={calendars} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    expect(screen.getByRole('button', { name: 'alerts.add' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Updated shared title' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Updated shared title', freeBusyStatus: 'free' });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('alerts');
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('useDefaultAlerts');
  });

  it('preserves existing reminder IDs and acknowledgments on a shared title-only save', async () => {
    const alerts = { 'opaque-alert': { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT10M', relativeTo: 'start' },
      action: 'display', acknowledged: '2026-10-01T00:00:00Z', relatedTo: null } } as CalendarEvent['alerts'];
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EventModal event={{ ...privateEvent, alerts }} calendars={[{ ...calendars[0], myRights: { ...calendars[0].myRights, mayUpdatePrivate: true } }]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    fireEvent.change(screen.getByPlaceholderText('form.title'), { target: { value: 'Title only' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('alerts');
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('useDefaultAlerts');
  });
});
