import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/lib/jmap/types';
import { EventContextMenu } from '../event-context-menu';
import { EventDetailPopover } from '../event-detail-popover';
import { EventCard } from '../event-card';
import { EventModal } from '../event-modal';
import comailMessages from '@/i18n/comail-messages.json';

const event = { id: 'account::atmo:event', source: 'atproto-public', '@type': 'Event', title: 'Public meetup',
  atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5',
  atprotoCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  start: '2026-10-10T10:00:00', utcStart: '2026-10-10T10:00:00Z', duration: 'PT1H', timeZone: 'UTC',
  calendarIds: { 'atmo:alice': true }, isOrigin: true, status: 'confirmed', description: '', participants: null } as unknown as CalendarEvent;

function handlers() {
  return { onEdit: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onClose: vi.fn(),
    onExportICS: vi.fn(), onCopyTitle: vi.fn(), onSaveNote: vi.fn(), onRsvp: vi.fn(),
    onSubscribePublic: vi.fn(), onPublicRsvp: vi.fn(), onPublishPublic: vi.fn() };
}

describe('public Atmo events in existing calendar controls', () => {
  it('keeps export and copying while removing write actions from the context menu', () => {
    const callbacks = handlers();
    render(<EventContextMenu event={event} position={{ x: 20, y: 20 }} isOpen menuRef={createRef()} {...callbacks} />);
    for (const key of ['events.edit', 'events.duplicate', 'events.delete']) expect(screen.queryByText(key)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('events.export_ics'));
    expect(callbacks.onExportICS).toHaveBeenCalledOnce();
    expect(screen.getByText('events.copy_title')).toBeInTheDocument();
    expect(screen.getByText('copy_event')).toBeInTheDocument();
  });

  it('keeps public details read-only while exposing explicit copy and RSVP actions', () => {
    const callbacks = handlers();
    render(<EventDetailPopover event={event} anchorRect={new DOMRect(20, 20, 100, 20)} {...callbacks} />);
    expect(screen.getByText('Public meetup')).toBeInTheDocument();
    for (const key of ['events.edit', 'events.duplicate', 'events.delete']) {
      expect(screen.queryByText(key)).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'atmo.add_to_my_calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'atmo.rsvp_interested' }));
    expect(callbacks.onSubscribePublic).toHaveBeenCalledOnce();
    expect(callbacks.onPublicRsvp).toHaveBeenCalledWith('interested');
    expect(comailMessages.common.calendar.atmo.add_to_my_calendar).toBe('Copy to My Calendar');
  });

  it('offers deliberate publication only for an unpublished My Calendar event', () => {
    const callbacks = handlers();
    const privateEvent = { ...event, id: 'space-event:one', source: 'atproto-space', atprotoUri: undefined,
      atprotoCid: undefined, calendarIds: { 'space:private': true }, privacy: 'private' } as CalendarEvent;
    render(<EventDetailPopover event={privateEvent} anchorRect={new DOMRect(20, 20, 100, 20)} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'atmo.publish_event' }));
    expect(callbacks.onPublishPublic).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'atmo.add_to_my_calendar' })).not.toBeInTheDocument();
  });

  it('keeps private reminder editing available on a linked copy', () => {
    const callbacks = handlers();
    const linked = { ...event, id: 'space-event:linked', source: 'atproto-space', calendarIds: { 'space:private': true } } as CalendarEvent;
    const calendar = { id: 'space:private', myRights: { mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: false,
      mayWriteOwn: false, mayUpdatePrivate: true, mayRSVP: false, mayShare: false, mayDelete: false } } as never;
    render(<EventDetailPopover event={linked} calendar={calendar} anchorRect={new DOMRect(20, 20, 100, 20)} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'events.edit' }));
    expect(callbacks.onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'events.delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'atmo.refresh_my_calendar' })).toBeInTheDocument();
  });

  it.each(['chip', 'span', 'block'] as const)('never makes a public %s draggable despite caller request', variant => {
    render(<EventCard event={event} variant={variant} draggable />);
    const card = screen.getByRole('button');
    expect(card).not.toHaveAttribute('draggable', 'true');
    expect(card).not.toHaveAttribute('aria-roledescription', 'draggable event');
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, setDragImage: vi.fn() } });
    expect(setData).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps public editor read-only in mobile mode %s', isMobile => {
    const callbacks = handlers();
    render(<EventModal event={event} calendars={[]} onSave={vi.fn()} {...callbacks} isMobile={isMobile} />);
    expect(screen.getByText('Public meetup')).toBeInTheDocument();
    for (const key of ['events.edit', 'events.duplicate', 'events.delete']) {
      expect(screen.queryByRole('button', { name: key })).not.toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(callbacks.onDuplicate).not.toHaveBeenCalled();
    expect(callbacks.onRsvp).not.toHaveBeenCalled();
  });

  it('does not announce an invented end on a public event card', () => {
    const openEnded = { ...event, duration: 'PT0S', utcEnd: null, atmoEndUnspecified: true } as CalendarEvent;
    render(<EventCard event={openEnded} variant="block" />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('atmo.end_unspecified');
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toContain(' – ');
  });

  it.each(['detail', 'editor'] as const)('shows the missing end honestly in %s', view => {
    const openEnded = { ...event, duration: 'PT0S', utcEnd: null, atmoEndUnspecified: true } as CalendarEvent;
    if (view === 'detail') render(<EventDetailPopover event={openEnded} anchorRect={new DOMRect(20, 20, 100, 20)} {...handlers()} />);
    else render(<EventModal event={openEnded} calendars={[]} onSave={vi.fn()} {...handlers()} />);
    expect(screen.getByText('atmo.end_unspecified')).toBeInTheDocument();
    expect(screen.queryByText('(0m)')).not.toBeInTheDocument();
  });

  it('preserves writable-event context actions', () => {
    render(<EventContextMenu event={{ ...event, id: 'local', source: 'jmap', calendarIds: { local: true } }}
      position={{ x: 20, y: 20 }} isOpen menuRef={createRef()} {...handlers()} />);
    for (const key of ['events.edit', 'events.duplicate', 'events.delete']) expect(screen.getByText(key)).toBeInTheDocument();
  });
});
