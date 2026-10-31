import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRef, useState } from 'react';
import { useMenuNavigation } from '../use-menu-navigation';

/**
 * The hook defers its first focus by a frame so portals can mount; drive rAF
 * synchronously so tests don't have to wait on the real scheduler.
 */
function flushFrames() {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

function Menu({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, onKeyDown } = useMenuNavigation<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
    triggerRef,
  });

  return (
    <>
      <button ref={triggerRef} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Open
      </button>
      {open && (
        <div ref={menuRef} role="menu" onKeyDown={onKeyDown}>
          <button role="menuitem">First</button>
          <button role="menuitem">Second</button>
          <button role="menuitem" disabled>Skipped</button>
          <button role="menuitem">Third</button>
        </div>
      )}
    </>
  );
}

describe('useMenuNavigation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves focus to the first item when the menu opens', () => {
    render(<Menu />);
    fireEvent.click(screen.getByText('Open'));
    flushFrames();

    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('cycles through items with the arrow keys, skipping disabled ones', () => {
    render(<Menu initialOpen />);
    flushFrames();

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByText('Second'));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByText('Third'));

    // Wraps back round to the top rather than dead-ending.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByText('First'));

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByText('Third'));
  });

  it('jumps to the ends with Home and End', () => {
    render(<Menu initialOpen />);
    flushFrames();

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByText('Third'));

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Menu initialOpen />);
    flushFrames();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    flushFrames();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Open'));
  });

  it('closes when focus tabs out of the menu', () => {
    render(<Menu initialOpen />);
    flushFrames();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
