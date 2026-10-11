import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HandleCombobox } from '../handle-combobox';
import type { ActorSuggestion } from '@/lib/atproto/handle';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUGGESTIONS: ActorSuggestion[] = [
  { did: 'did:plc:a', handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://cdn.bsky.app/alice.webp' },
  { did: 'did:plc:b', handle: 'alicia.bsky.social', displayName: 'Alicia' },
];

describe('HandleCombobox', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('exposes the required combobox ARIA attributes', () => {
    render(<HandleCombobox value="" onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-controls');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('renders an accessible listbox of options after typing (debounced)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));

    render(<HandleCombobox value="" onChange={() => {}} debounceMs={200} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ali' } });

    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();

    const listbox = await screen.findByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
  });


  it('shows a decorative profile picture and falls back when it fails', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));
    render(<HandleCombobox value="" onChange={() => {}} debounceMs={0} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ali' } });
    const options = await screen.findAllByRole('option');
    const image = options[0].querySelector('img');
    expect(image).toHaveAttribute('src', SUGGESTIONS[0].avatar);
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    const avatar = image!.parentElement!;
    fireEvent.error(image!);
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar).toHaveTextContent('A');
    expect(options[1].querySelector('img')).toBeNull();
  });

  it('reflects the active option in aria-activedescendant on ArrowDown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));

    render(<HandleCombobox value="" onChange={() => {}} debounceMs={200} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ali' } });
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();

    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const options = screen.getAllByRole('option');
    await waitFor(() =>
      expect(input).toHaveAttribute('aria-activedescendant', options[0].id),
    );
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('selecting an option updates the input value', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));
    const onChange = vi.fn();

    render(<HandleCombobox value="" onChange={onChange} debounceMs={200} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ali' } });
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();

    const options = await screen.findByText('alice.bsky.social');
    fireEvent.click(options);
    expect(onChange).toHaveBeenLastCalledWith('alice.bsky.social');
  });
});
