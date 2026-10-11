import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageListOrderSettings } from '../message-list-order-settings';
import { useSettingsStore, DEFAULT_KEYWORDS } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Settings → Appearance → "Message list order" (#718): a preset dropdown over
// the same level list the advanced editor exposes, persisted through the
// synced settings store.

describe('MessageListOrderSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      messageListOrder: [],
      messageListOrderScope: 'inbox',
      emailKeywords: [...DEFAULT_KEYWORDS],
    });
    useAuthStore.setState({ client: null });
  });

  const presetSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;

  it('shows the chronological preset by default and keeps the editor closed', () => {
    render(<MessageListOrderSettings />);
    expect(presetSelect().value).toBe('chronological');
    expect(screen.queryByTestId('message-list-order-editor')).toBeNull();
    // No "custom" entry unless the order actually is custom.
    expect(screen.queryByText('preset.custom')).toBeNull();
  });

  it('applies a simple preset as a single sort level', () => {
    render(<MessageListOrderSettings />);
    fireEvent.change(presetSelect(), { target: { value: 'unread_first' } });
    expect(useSettingsStore.getState().messageListOrder).toEqual([{ criterion: 'unread', direction: 'desc' }]);
    expect(presetSelect().value).toBe('unread_first');

    fireEvent.change(presetSelect(), { target: { value: 'chronological' } });
    expect(useSettingsStore.getState().messageListOrder).toEqual([]);
  });

  it('uses the first tag for "tagged first" and lets the tag be changed', () => {
    render(<MessageListOrderSettings />);
    fireEvent.change(presetSelect(), { target: { value: 'tagged_first' } });
    expect(useSettingsStore.getState().messageListOrder).toEqual([
      { criterion: 'tag', direction: 'desc', tagId: DEFAULT_KEYWORDS[0].id },
    ]);

    const tagSelect = screen.getByLabelText('tag_label') as HTMLSelectElement;
    fireEvent.change(tagSelect, { target: { value: DEFAULT_KEYWORDS[1].id } });
    expect(useSettingsStore.getState().messageListOrder[0].tagId).toBe(DEFAULT_KEYWORDS[1].id);
  });

  it('opens the advanced editor on a custom order and reports it as custom', () => {
    useSettingsStore.setState({
      messageListOrder: [
        { criterion: 'unread', direction: 'desc' },
        { criterion: 'starred', direction: 'desc' },
      ],
    });
    render(<MessageListOrderSettings />);
    expect(presetSelect().value).toBe('custom');
    expect(screen.getByTestId('message-list-order-editor')).toBeInTheDocument();
    expect(screen.getByTestId('message-list-order-level-0')).toBeInTheDocument();
    expect(screen.getByTestId('message-list-order-level-1')).toBeInTheDocument();
  });

  it('adds, edits, reorders and removes levels in the editor', () => {
    render(<MessageListOrderSettings />);
    fireEvent.click(screen.getByTestId('message-list-order-advanced-toggle'));

    fireEvent.click(screen.getByTestId('message-list-order-add-level'));
    expect(useSettingsStore.getState().messageListOrder).toEqual([{ criterion: 'unread', direction: 'desc' }]);

    // Switching the criterion resets the direction to that criterion's default.
    fireEvent.change(screen.getByLabelText('criterion_label'), { target: { value: 'from' } });
    expect(useSettingsStore.getState().messageListOrder).toEqual([{ criterion: 'from', direction: 'asc' }]);
    fireEvent.change(screen.getByLabelText('direction_label'), { target: { value: 'desc' } });
    expect(useSettingsStore.getState().messageListOrder).toEqual([{ criterion: 'from', direction: 'desc' }]);

    fireEvent.click(screen.getByTestId('message-list-order-add-level'));
    fireEvent.click(screen.getByTestId('message-list-order-add-level'));
    expect(useSettingsStore.getState().messageListOrder.map(l => l.criterion)).toEqual(['from', 'unread', 'starred']);
    // Capped at three levels.
    expect(screen.queryByTestId('message-list-order-add-level')).toBeNull();

    fireEvent.click(screen.getAllByLabelText('move_up')[2]);
    expect(useSettingsStore.getState().messageListOrder.map(l => l.criterion)).toEqual(['from', 'starred', 'unread']);

    fireEvent.click(screen.getAllByLabelText('remove_level')[0]);
    expect(useSettingsStore.getState().messageListOrder.map(l => l.criterion)).toEqual(['starred', 'unread']);
  });

  it('toggles the all-folders scope', () => {
    render(<MessageListOrderSettings />);
    fireEvent.click(screen.getByTestId('message-list-order-scope'));
    expect(useSettingsStore.getState().messageListOrderScope).toBe('all');
    fireEvent.click(screen.getByTestId('message-list-order-scope'));
    expect(useSettingsStore.getState().messageListOrderScope).toBe('inbox');
  });

  it('warns when the server advertises sort options without hasKeyword', () => {
    useSettingsStore.setState({ messageListOrder: [{ criterion: 'unread', direction: 'desc' }] });
    useAuthStore.setState({
      client: { getEmailQuerySortOptions: vi.fn(() => ['receivedAt', 'size']) } as unknown as IJMAPClient,
    });
    render(<MessageListOrderSettings />);
    expect(screen.getByText('unsupported_note')).toBeInTheDocument();
  });

  it('stays quiet when the server supports keyword sorting or does not say', () => {
    useSettingsStore.setState({ messageListOrder: [{ criterion: 'unread', direction: 'desc' }] });
    useAuthStore.setState({
      client: { getEmailQuerySortOptions: vi.fn(() => ['receivedAt', 'hasKeyword']) } as unknown as IJMAPClient,
    });
    const { unmount } = render(<MessageListOrderSettings />);
    expect(screen.queryByText('unsupported_note')).toBeNull();
    unmount();

    useAuthStore.setState({ client: { getEmailQuerySortOptions: vi.fn(() => null) } as unknown as IJMAPClient });
    render(<MessageListOrderSettings />);
    expect(screen.queryByText('unsupported_note')).toBeNull();
  });
});
