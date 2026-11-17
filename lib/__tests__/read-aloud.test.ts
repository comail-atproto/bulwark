import { describe, expect, it } from 'vitest';
import { collectSpeechText, pickVoice, rangeForOffsets, splitSentences, voicesForLocale, wordEnd } from '@/lib/read-aloud';

function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('collectSpeechText', () => {
  it('reads what is on screen, block by block, with alt text', () => {
    const el = root('<p>Hello <b>Ann</b>.</p><p>See <img alt="the chart"> below.</p><div style="display:none">hidden</div><button>Play</button>');
    expect(collectSpeechText(el).text).toBe('Hello Ann.\nSee  the chart  below.\n');
  });

  it('reads only the summary of a folded quote', () => {
    const el = root('<p>Reply</p><details><summary>Show quoted text</summary><p>Old mail</p></details>');
    expect(collectSpeechText(el).text).not.toContain('Old mail');
  });
});

describe('splitSentences', () => {
  it('splits sentences and lines, dropping empty ones', () => {
    const text = 'Hi Ann. How are you?\n\nBest,\nBob';
    expect(splitSentences(text, 'en').map(({ start, end }) => text.slice(start, end))).toEqual(['Hi Ann.', 'How are you?', 'Best,', 'Bob']);
  });

  it('cuts long sentences so no utterance gets too long', () => {
    const text = `${'word '.repeat(120)}end.`;
    const chunks = splitSentences(text, 'en');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(({ start, end }) => end - start <= 220)).toBe(true);
    expect(chunks.map(({ start, end }) => text.slice(start, end)).join(' ')).toBe(text.trim());
  });
});

describe('rangeForOffsets', () => {
  it('maps spoken offsets back to the text nodes', () => {
    const el = root('<p>Hello <b>dear</b> Ann</p>');
    const speech = collectSpeechText(el);
    const start = speech.text.indexOf('dear');
    const range = rangeForOffsets(speech, start, start + 8)!;
    expect(range.toString()).toBe('dear Ann');
  });

  it('is null for text that is not on the page', () => {
    const el = root('<img alt="logo">');
    const speech = collectSpeechText(el);
    expect(rangeForOffsets(speech, 0, speech.text.length)).toBeNull();
  });
});

describe('voices', () => {
  const voice = (name: string, lang: string) => ({ name, lang, voiceURI: `uri:${name}` }) as SpeechSynthesisVoice;
  const voices = [voice('Zoe', 'en-US'), voice('Anna', 'de-DE'), voice('Max', 'de_AT')];

  it('lists the voices for the interface language', () => {
    expect(voicesForLocale(voices, 'de').map((v) => v.name)).toEqual(['Anna', 'Max']);
  });

  it('picks the chosen voice, or none for the browser default', () => {
    expect(pickVoice(voices, 'uri:Max')?.name).toBe('Max');
    expect(pickVoice(voices, 'Zoe')?.name).toBe('Zoe');
    expect(pickVoice(voices, '')).toBeNull();
    expect(pickVoice(voices, 'uri:gone')).toBeNull();
  });

  it('finds the end of a word', () => {
    expect(wordEnd('say hello world', 4)).toBe(9);
  });
});
