import { render, cleanup, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CalendarWeekView } from '../calendar-week-view';
import { CalendarDayView } from '../calendar-day-view';
import { CalendarMonthView } from '../calendar-month-view';
import type { CalendarEvent, Calendar, CalendarTask } from '@/lib/jmap/types';

// SR-14: the week, day and month grids must have the structure ARIA asks
// of a grid, or screen readers skip the events: rows hold cells, headers
// sit in a row, every event and button sits in a cell, column N of each
// row is the same day, and no generic element carries a name.

const calendars = [{ id: 'cal-1', name: 'Work', color: '#3b82f6' }] as unknown as Calendar[];

function makeEvent(id: string, start: string, duration: string, showWithoutTime = false): CalendarEvent {
  return {
    id, '@type': 'Event', uid: id, title: 'Event ' + id, start, duration, showWithoutTime,
    calendarIds: { 'cal-1': true },
  } as unknown as CalendarEvent;
}

const task = {
  id: 't1', '@type': 'Task', uid: 't1', title: 'Task t1', due: '2026-09-09', showWithoutTime: true,
  progress: 'needs-action', calendarIds: { 'cal-1': true },
} as unknown as CalendarTask;

const events = [
  makeEvent('timed', '2026-09-09T10:00:00', 'PT1H'),
  makeEvent('trip', '2026-09-08', 'P2D', true),
];

const common = {
  focus: { date: new Date(2026, 8, 9), nonce: 0 },
  selectedDate: new Date(2026, 8, 9),
  events,
  calendars,
  tasks: [task],
  onSelectDate: vi.fn(),
  onSelectEvent: vi.fn(),
  onCreateAtTime: vi.fn(),
};

const CELL = '[role="gridcell"], [role="columnheader"], [role="rowheader"]';

/** What axe's aria-required-children / -parent and aria-prohibited-attr would flag. */
function gridProblems(grid: HTMLElement): string[] {
  const problems: string[] = [];
  for (const cell of grid.querySelectorAll<HTMLElement>(CELL)) {
    if (!cell.parentElement?.closest('[role="row"]')) problems.push(`cell without a row: ${cell.outerHTML.slice(0, 80)}`);
  }
  for (const row of grid.querySelectorAll<HTMLElement>('[role="row"]')) {
    for (const control of row.querySelectorAll<HTMLElement>('button, [role="button"], [tabindex]')) {
      if (!control.closest(CELL) || !row.contains(control.closest(CELL))) {
        problems.push(`control outside a cell: ${control.outerHTML.slice(0, 80)}`);
      }
    }
    if (row.querySelector('[role="row"]')) problems.push('row inside a row');
  }
  for (const el of grid.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (!el.getAttribute('role') && !['BUTTON', 'A', 'INPUT', 'TABLE', 'TH', 'TD', 'SECTION', 'NAV'].includes(el.tagName)) {
      problems.push(`name on an element without a role: ${el.outerHTML.slice(0, 80)}`);
    }
  }
  return problems;
}

/** The number of cells in each row, which must agree so column N is day N. */
function cellCounts(grid: HTMLElement): number[] {
  return Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]')).map((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(CELL)).filter((cell) => cell.parentElement!.closest('[role="row"]') === row).length,
  );
}

describe('calendar grid semantics (SR-14)', () => {
  afterEach(cleanup);

  it('week view: header, all-day and hours rows with one cell per day, events inside them', () => {
    render(
      <CalendarWeekView
        {...common}
        windowKey="week:2026-09-07"
        rangeStart={new Date(2026, 8, 7)}
        rangeEnd={new Date(2026, 8, 13)}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(gridProblems(grid)).toEqual([]);
    const counts = cellCounts(grid);
    expect(counts).toHaveLength(3);
    expect(new Set(counts)).toEqual(new Set([8]));
    // The timed event is in Wednesday's cell of the hours row: under the
    // Wednesday column header.
    const event = screen.getByRole('button', { name: /^Event timed/ });
    const row = event.closest('[role="row"]')!;
    const cells = Array.from(row.querySelectorAll(CELL)).filter((c) => c.parentElement!.closest('[role="row"]') === row);
    const headers = Array.from(grid.querySelectorAll('[role="row"]')[0].querySelectorAll(CELL));
    const column = cells.indexOf(event.closest(CELL)!);
    // (Without an intl provider the test formatter prints the raw date.)
    expect(headers[column]).toHaveAttribute('aria-label', expect.stringMatching(/Sep 09 2026/));
    // Resize handles are pointer-only decorations, without a name.
    for (const handle of grid.querySelectorAll('[data-resize-handle]')) {
      expect(handle).not.toHaveAttribute('aria-label');
      expect(handle).toHaveAttribute('aria-hidden', 'true');
    }
    // An empty hour is a button named with its date and time.
    expect(screen.getAllByRole('button', { name: /Sep 09 2026.*, 10:00$/ }).length).toBe(1);
  });

  it('day view: the date header sits in a row, the all-day entries in a cell', () => {
    render(
      <CalendarDayView
        {...common}
        windowKey="day:2026-09-09"
        rangeStart={new Date(2026, 8, 9)}
        rangeEnd={new Date(2026, 8, 9)}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(gridProblems(grid)).toEqual([]);
    expect(new Set(cellCounts(grid))).toEqual(new Set([2]));
    expect(screen.getByRole('button', { name: /^Event trip/ }).closest('[role="gridcell"]')).not.toBeNull();
  });

  it('month view: events, tasks and the day\'s date all inside the day\'s cell, and the cell not named over them', () => {
    render(
      <CalendarMonthView
        {...common}
        windowKey="month:2026-09-09"
        rangeStart={new Date(2026, 7, 31)}
        rangeEnd={new Date(2026, 9, 4)}
      />,
    );
    const grid = screen.getAllByRole('grid').find((g) => /views\.month/.test(g.getAttribute('aria-label') ?? ''))!;
    expect(gridProblems(grid)).toEqual([]);
    expect(new Set(cellCounts(grid))).toEqual(new Set([7]));
    for (const cell of grid.querySelectorAll('[role="gridcell"]')) {
      expect(cell).not.toHaveAttribute('aria-label');
    }
    const trip = screen.getByRole('button', { name: /^Event trip/ });
    const cell = trip.closest('[role="gridcell"]')!;
    expect(cell.querySelector('[data-day-button]')).toHaveAttribute('aria-label', expect.stringMatching(/September 8/));
  });
});
