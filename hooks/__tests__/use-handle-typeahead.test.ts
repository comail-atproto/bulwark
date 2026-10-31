import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHandleTypeahead } from '../use-handle-typeahead';
import type { ActorSuggestion } from '@/lib/atproto/handle';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUGGESTIONS: ActorSuggestion[] = [
  { did: 'did:plc:a', handle: 'alice.bsky.social', displayName: 'Alice' },
  { did: 'did:plc:b', handle: 'alicia.bsky.social', displayName: 'Alicia' },
];

describe('useHandleTypeahead', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('debounces typeahead and populates suggestions after the delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));

    const { result } = renderHook(() => useHandleTypeahead({ debounceMs: 300 }));

    act(() => result.current.onQueryChange('ali'));

    // Before the debounce window elapses, no request should have fired.
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not query for a query shorter than the minimum length', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useHandleTypeahead({ debounceMs: 300, minChars: 2 }));

    act(() => result.current.onQueryChange('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
  });

  it('clears suggestions and closes when the query is emptied', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));
    const { result } = renderHook(() => useHandleTypeahead({ debounceMs: 300 }));

    act(() => result.current.onQueryChange('ali'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));

    act(() => result.current.onQueryChange(''));
    await waitFor(() => expect(result.current.suggestions).toEqual([]));
    expect(result.current.isOpen).toBe(false);
  });

  it('arrow keys move the active index and Enter selects a suggestion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useHandleTypeahead({ debounceMs: 300, onSelect }),
    );

    act(() => result.current.onQueryChange('ali'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));

    // ArrowDown -> index 0, ArrowDown -> index 1.
    act(() => result.current.onKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as never));
    act(() => result.current.onKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as never));
    expect(result.current.activeIndex).toBe(1);

    act(() => result.current.onKeyDown({ key: 'Enter', preventDefault: () => {} } as never));
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  it('Escape closes the listbox', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));
    const { result } = renderHook(() => useHandleTypeahead({ debounceMs: 300 }));

    act(() => result.current.onQueryChange('ali'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(result.current.isOpen).toBe(true));

    act(() => result.current.onKeyDown({ key: 'Escape', preventDefault: () => {} } as never));
    expect(result.current.isOpen).toBe(false);
  });

  it('aborts the in-flight request when a new keystroke supersedes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const signals: Array<AbortSignal | undefined> = [];
    fetchSpy.mockImplementation((_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse(200, { actors: SUGGESTIONS })), 1000);
      });
    });

    const { result } = renderHook(() => useHandleTypeahead({ debounceMs: 300 }));

    act(() => result.current.onQueryChange('ali'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // First request in flight.
    expect(signals[0]?.aborted).toBe(false);

    act(() => result.current.onQueryChange('alic'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The first request's signal must now be aborted.
    expect(signals[0]?.aborted).toBe(true);
  });


  it('closing cancels a pending response and keeps suggestions closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveResponse: (value: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const { result } = renderHook(() => useHandleTypeahead());
    act(() => result.current.onQueryChange('ali'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    act(() => result.current.close());
    await act(async () => { resolveResponse(jsonResponse(200, { actors: SUGGESTIONS })); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.suggestions).toEqual([]);
  });

  it('Escape cancels a search before its debounce fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy.mockResolvedValue(jsonResponse(200, { actors: SUGGESTIONS }));
    const { result } = renderHook(() => useHandleTypeahead());
    act(() => result.current.onQueryChange('ali'));
    act(() => result.current.onKeyDown({ key: 'Escape', preventDefault: () => {} } as never));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });

  it('aborts any in-flight request on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let capturedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse(200, { actors: SUGGESTIONS })), 1000);
      });
    });

    const { result, unmount } = renderHook(() => useHandleTypeahead({ debounceMs: 300 }));
    act(() => result.current.onQueryChange('ali'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
