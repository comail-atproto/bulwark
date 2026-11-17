import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TagBadge } from '../tag-badge';
import { useSettingsStore, type KeywordDefinition } from '@/stores/settings-store';

const TAGS: KeywordDefinition[] = [
  { id: 'work', label: 'Work', color: 'blue' },
  { id: 'work/clients', label: 'Clients', color: 'green' },
];

describe('TagBadge', () => {
  beforeEach(() => {
    useSettingsStore.setState({ emailKeywords: TAGS, nestedTags: true, showColorNames: false });
  });

  it('names the tag by its full path', () => {
    render(<TagBadge tagId="work/clients" variant="badge" />);
    expect(screen.getByText('Work/Clients')).toBeInTheDocument();
  });

  it('names a tag it has no definition for by its id', () => {
    render(<TagBadge tagId="from-elsewhere" variant="badge" />);
    expect(screen.getByText('from-elsewhere')).toBeInTheDocument();
  });

  it('offers removal only when asked to', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<TagBadge tagId="work" variant="badge" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<TagBadge tagId="work" variant="badge" onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'remove_tag' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('gives the remove button a 24px target: a 12px icon and 6px padding all round', () => {
    render(<TagBadge tagId="work" variant="badge" onRemove={() => {}} />);
    const remove = screen.getByRole('button', { name: 'remove_tag' });
    expect(remove).toHaveClass('p-1.5');
    expect(remove.querySelector('svg')).toHaveClass('w-3', 'h-3');
  });

  it('leaves the dot alone, having nowhere to put the control', () => {
    render(<TagBadge tagId="work" variant="dot" onRemove={() => {}} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Work')).toHaveClass('sr-only');
  });

  // CV-01: a dot was colour only for sighted users.
  it('puts the first letter in the dot', () => {
    const { container } = render(<TagBadge tagId="work" variant="dot" />);
    const dot = container.querySelector('[data-tag-dot]')!;
    expect(dot.querySelector('[aria-hidden="true"]')).toHaveTextContent('W');
  });

  it('names the tag in full where a dot would go with colour names on', () => {
    useSettingsStore.setState({ showColorNames: true });
    const { container } = render(<TagBadge tagId="work/clients" variant="dot" />);
    expect(container.querySelector('[data-tag-dot]')).toBeNull();
    expect(screen.getByText('Work/Clients')).not.toHaveClass('sr-only');
  });
});
