import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextMenu, ContextMenuItem, ContextMenuSubMenu } from '../context-menu';
import { useSettingsStore } from '@/stores/settings-store';

// MO-17: with "open on hover" off, a submenu opens on click or Enter only,
// and hovering another entry doesn't close it.

afterEach(() => {
  useSettingsStore.setState({ openOnHover: true });
});

function menu() {
  render(
    <ContextMenu isOpen position={{ x: 10, y: 10 }} onClose={() => {}}>
      <ContextMenuItem label="Reply" onClick={() => {}} />
      <ContextMenuSubMenu label="Move to" testId="sub">
        <ContextMenuItem label="Spam" onClick={() => {}} />
      </ContextMenuSubMenu>
    </ContextMenu>,
  );
}

describe('submenus and hover', () => {
  it('opens on hover by default', () => {
    menu();
    act(() => { fireEvent.mouseEnter(screen.getByTestId('sub').parentElement!); });
    expect(screen.getByText('Spam')).toBeInTheDocument();
  });

  it('does not open on hover with the setting off', () => {
    useSettingsStore.setState({ openOnHover: false });
    menu();
    act(() => { fireEvent.mouseEnter(screen.getByTestId('sub').parentElement!); });
    expect(screen.queryByText('Spam')).toBeNull();
    expect(screen.getByTestId('sub')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on click with the setting off and stays while another entry is hovered', async () => {
    useSettingsStore.setState({ openOnHover: false });
    menu();
    act(() => { fireEvent.click(screen.getByTestId('sub')); });
    expect(screen.getByText('Spam')).toBeInTheDocument();
    act(() => { fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Reply' })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(screen.getByText('Spam')).toBeInTheDocument();
  });
});
