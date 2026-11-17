import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadAloud } from '@/hooks/use-read-aloud';
import { useSettingsStore } from '@/stores/settings-store';

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: { name: string; charIndex: number; charLength?: number }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const spoken: FakeUtterance[] = [];
const synth = {
  speak: vi.fn((u: FakeUtterance) => { spoken.push(u); }),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  getVoices: () => [{ name: 'Anna', lang: 'de-DE', voiceURI: 'uri:anna' }],
};

beforeEach(() => {
  spoken.length = 0;
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', synth);
  useSettingsStore.setState({ readAloudRate: 1.25, readAloudVoice: 'uri:anna' } as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function body(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('useReadAloud', () => {
  it('reads sentence by sentence at the chosen speed and voice', () => {
    const el = body('<p>First sentence. Second one.</p>');
    const { result } = renderHook(() => useReadAloud({ getRoot: () => el, lang: 'de' }));
    expect(result.current.supported).toBe(true);
    act(() => result.current.start());
    expect(result.current.state).toBe('speaking');
    expect(spoken.map((u) => u.text)).toEqual(['First sentence.']);
    expect(spoken[0].rate).toBe(1.25);
    expect(spoken[0].voice).toMatchObject({ name: 'Anna' });
    act(() => spoken[0].onend!());
    expect(spoken.map((u) => u.text)).toEqual(['First sentence.', 'Second one.']);
    act(() => spoken[1].onend!());
    expect(result.current.state).toBe('idle');
  });

  it('pauses, resumes and stops', () => {
    const el = body('<p>One. Two.</p>');
    const { result } = renderHook(() => useReadAloud({ getRoot: () => el }));
    act(() => result.current.start());
    act(() => result.current.pause());
    expect(synth.pause).toHaveBeenCalled();
    expect(result.current.state).toBe('paused');
    act(() => result.current.resume());
    expect(result.current.state).toBe('speaking');
    act(() => result.current.stop());
    expect(synth.cancel).toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
    // A late end event from the cancelled run starts nothing.
    act(() => spoken[0].onend!());
    expect(spoken).toHaveLength(1);
  });

  it('stops when another message opens', () => {
    const el = body('<p>One. Two.</p>');
    const { result, rerender } = renderHook(({ id }) => useReadAloud({ getRoot: () => el, resetKey: id }), { initialProps: { id: 'a' } });
    act(() => result.current.start());
    synth.cancel.mockClear();
    rerender({ id: 'b' });
    expect(synth.cancel).toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });
});
