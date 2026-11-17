import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchTagButton } from '../batch-tag-button';
import { useSettingsStore, type KeywordDefinition } from '@/stores/settings-store';

// The selection toolbar's tag menu sits at the end of <body>. The focus has
// to go into it, the arrow keys walk the tags, and Escape hands the focus
// back to the button.

const TAGS: KeywordDefinition[] = [
  { id: 'work', label: 'Work', color: 'blue' },
  { id: 'personal', label: 'Personal', color: 'purple' },
];

describe('BatchTagButton', () => {
  beforeEach(() => {
    useSettingsStore.setState({ emailKeywords: TAGS, nestedTags: true });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
  });

  it('moves the focus into the menu and back to the button', () => {
    render(<BatchTagButton title="Tag" selectedIds={[]} partialIds={[]} onToggle={() => {}} active />);
    const button = screen.getByRole('button', { name: 'Tag' });
    button.focus();
    act(() => { fireEvent.click(button); });

    const menu = screen.getByRole('menu', { name: 'Tag' });
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();

    act(() => { fireEvent.keyDown(items[1], { key: 'Escape' }); });
    expect(menu).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
