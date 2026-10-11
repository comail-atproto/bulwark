import { describe, it, expect } from 'vitest';
import {
  buildSearchSuggestions,
  splitHighlight,
  MAX_RECENT_IDLE,
  MAX_RECENT_TYPING,
  MAX_CONTACT_SUGGESTIONS,
} from '../search-suggestions';

const contacts = [
  { name: 'Mustafa Kemal', email: 'mustafa@example.com' },
  { name: 'Mustafa Sandal', email: 'sandal@example.com' },
];

describe('buildSearchSuggestions', () => {
  it('shows only recent searches when the query is empty', () => {
    const recent = ['invoice', 'mustafa', 'q3 report'];
    expect(buildSearchSuggestions('', recent, contacts)).toEqual([
      { kind: 'recent', query: 'invoice' },
      { kind: 'recent', query: 'mustafa' },
      { kind: 'recent', query: 'q3 report' },
    ]);
  });

  it('caps idle recent searches', () => {
    const recent = Array.from({ length: 12 }, (_, i) => `search ${i}`);
    const result = buildSearchSuggestions('   ', recent, []);
    expect(result).toHaveLength(MAX_RECENT_IDLE);
    expect(result[0]).toEqual({ kind: 'recent', query: 'search 0' });
  });

  it('filters recent searches by substring, case-insensitively, while typing', () => {
    const recent = ['Invoice March', 'mustafa', 'invoice april', 'q3 report'];
    const result = buildSearchSuggestions('INV', recent, []);
    expect(result).toEqual([
      { kind: 'recent', query: 'Invoice March' },
      { kind: 'recent', query: 'invoice april' },
    ]);
  });

  it('omits a recent search that exactly equals the typed query', () => {
    const result = buildSearchSuggestions('mustafa', ['mustafa', 'mustafa kemal'], []);
    expect(result).toEqual([{ kind: 'recent', query: 'mustafa kemal' }]);
  });

  it('limits recent matches while typing so contacts stay visible', () => {
    const recent = Array.from({ length: 6 }, (_, i) => `invoice ${i}`);
    const result = buildSearchSuggestions('invoice', recent, []);
    expect(result).toHaveLength(MAX_RECENT_TYPING);
  });

  it('lists recent searches before contact matches', () => {
    const result = buildSearchSuggestions('musta', ['mustafa invoice'], contacts);
    expect(result.map((s) => s.kind)).toEqual(['recent', 'contact', 'contact']);
    expect(result[1]).toEqual({ kind: 'contact', name: 'Mustafa Kemal', email: 'mustafa@example.com' });
  });

  it('drops group entries (no address) and duplicate addresses', () => {
    const result = buildSearchSuggestions('m', [], [
      { name: 'Marketing group', email: '' },
      { name: 'Mustafa', email: 'mustafa@example.com' },
      { name: 'Mustafa (alt)', email: 'MUSTAFA@example.com' },
      { name: '', email: '  ' },
    ]);
    expect(result).toEqual([{ kind: 'contact', name: 'Mustafa', email: 'mustafa@example.com' }]);
  });

  it('caps contact matches', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Person ${i}`, email: `p${i}@example.com` }));
    expect(buildSearchSuggestions('p', [], many)).toHaveLength(MAX_CONTACT_SUGGESTIONS);
  });
});

describe('splitHighlight', () => {
  it('returns the whole text unmatched for an empty query', () => {
    expect(splitHighlight('Mustafa', '')).toEqual([{ text: 'Mustafa', match: false }]);
    expect(splitHighlight('Mustafa', '   ')).toEqual([{ text: 'Mustafa', match: false }]);
  });

  it('marks every case-insensitive occurrence, preserving original casing', () => {
    expect(splitHighlight('Anna Hannah', 'an')).toEqual([
      { text: 'An', match: true },
      { text: 'na H', match: false },
      { text: 'an', match: true },
      { text: 'nah', match: false },
    ]);
  });

  it('handles matches at the very start and end', () => {
    expect(splitHighlight('mustafa@example.com', 'mustafa')).toEqual([
      { text: 'mustafa', match: true },
      { text: '@example.com', match: false },
    ]);
    expect(splitHighlight('mail from bob', 'bob')).toEqual([
      { text: 'mail from ', match: false },
      { text: 'bob', match: true },
    ]);
  });

  it('returns an unmatched segment when there is no occurrence', () => {
    expect(splitHighlight('Alice', 'zed')).toEqual([{ text: 'Alice', match: false }]);
  });
});
