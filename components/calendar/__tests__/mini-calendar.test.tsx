import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useState } from 'react';
import { MiniCalendar } from '../mini-calendar';
import type { CalendarEvent } from '@/lib/jmap/types';

// SR-14: the mini calendar is a real grid, its days are named with the full
// date, event days are marked in words and the arrows move between days.

const event = {
  id: 'e1',
  '@type': 'Event',
  title: 'Dentist',
  start: '2026-10-29T10:00:00',
  duration: 'PT1H',
  showWithoutTime: false,
  calendarIds: { c1: true },
} as unknown as CalendarEvent;

function Harness({ onSelectDate = vi.fn(), onChangeMonth }: { onSelectDate?: (d: Date) => void; onChangeMonth?: (d: Date) => void }) {
  const [month, setMonth] = useState(new Date(2026, 9, 1));
  return (
    <MiniCalendar
      selectedDate={new Date(2026, 9, 15)}
      displayMonth={month}
      onSelectDate={onSelectDate}
      onChangeMonth={(d) => { onChangeMonth?.(d); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}
      events={[event]}
      showWeekNumbers
    />
  );
}

const day = (name: RegExp) => screen.getByRole('button', { name });

describe('MiniCalendar', () => {
  afterEach(cleanup);

  it('is a grid of rows and cells with weekday column headers', () => {
    render(<Harness />);
    const grid = screen.getByRole('grid');
    expect(within(grid).getAllByRole('columnheader').length).toBe(8);
    expect(within(grid).getAllByRole('row').length).toBeGreaterThanOrEqual(5);
    const cell = day(/October 15, 2026/).closest('[role="gridcell"]');
    expect(cell).toHaveAttribute('aria-selected', 'true');
    expect(within(grid).getAllByRole('rowheader', { name: /mini_week_number/ }).length).toBeGreaterThanOrEqual(5);
  });

  it('names each day with its full date and says which days have events', () => {
    render(<Harness />);
    expect(day(/^Thursday, October 29, 2026, mini_has_events$/)).toBeInTheDocument();
    expect(day(/^Wednesday, October 28, 2026$/)).toBeInTheDocument();
  });

  it('is one tab stop, on the selected day', () => {
    render(<Harness />);
    const stops = screen.getByRole('grid').querySelectorAll('button[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(day(/October 15, 2026/));
  });

  it('moves focus with the arrow keys without selecting', () => {
    const onSelectDate = vi.fn();
    render(<Harness onSelectDate={onSelectDate} />);
    day(/October 15, 2026/).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(day(/October 16, 2026/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(day(/October 23, 2026/));
    expect(document.activeElement).toHaveAttribute('tabindex', '0');
    expect(onSelectDate).not.toHaveBeenCalled();
    fireEvent.click(document.activeElement!);
    expect(onSelectDate).toHaveBeenCalledWith(new Date(2026, 9, 23));
  });

  it('turns the month when the arrows leave it and keeps focus on the new day', () => {
    const onChangeMonth = vi.fn();
    render(<Harness onChangeMonth={onChangeMonth} />);
    day(/October 29, 2026/).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(onChangeMonth).toHaveBeenCalled();
    expect(screen.getByRole('grid')).toHaveAccessibleName(/November/);
    expect(document.activeElement).toBe(day(/November 5, 2026/));
    fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    expect(document.activeElement).toBe(day(/October 5, 2026/));
  });

  it("draws other months' days in a colour that keeps text contrast, not a faded one", () => {
    render(<Harness />);
    const circle = day(/September 28, 2026/).firstElementChild!;
    expect(circle.className).toContain('text-muted-foreground');
    expect(circle.className).not.toMatch(/text-muted-foreground\/\d+/);
  });

  it('tells which month is selected in the month picker', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /October 2026/ }));
    expect(screen.getByRole('button', { name: 'months.oct' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'months.sep' })).toHaveAttribute('aria-pressed', 'false');
  });
});
