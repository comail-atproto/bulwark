/**
 * Read aloud: the text of a message body, split into sentences for the
 * browser's speech synthesis, with a map back to the DOM so the sentence and
 * word being spoken can be highlighted.
 *
 * Runs entirely in the browser (Web Speech API), so it works in Lite and
 * without a server.
 */

/** Where a piece of the spoken text came from; `node` is null for text we added (line breaks, alt text). */
export interface SpeechSegment {
  node: Text | null;
  start: number;
  end: number;
}

export interface SpeechText {
  text: string;
  segments: SpeechSegment[];
}

const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL|TD|TH)$/;
const SKIP = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|BUTTON|SVG|CANVAS|SELECT|TEXTAREA)$/;

/**
 * The text of `root` as it reads on screen: hidden parts left out, a line
 * break after each block, image alt text in place of the image.
 */
export function collectSpeechText(root: Element): SpeechText {
  const view = root.ownerDocument.defaultView;
  const segments: SpeechSegment[] = [];
  let text = '';
  const add = (value: string, node: Text | null) => {
    if (!value) return;
    segments.push({ node, start: text.length, end: text.length + value.length });
    text += value;
  };
  const breakLine = () => {
    if (text && !text.endsWith('\n')) add('\n', null);
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      add(node.nodeValue ?? '', node as Text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.test(tag) || el.getAttribute('aria-hidden') === 'true') return;
    if (view) {
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
    }
    // A closed <details> (the folded quote) shows only its summary.
    if (tag === 'DETAILS' && !(el as HTMLDetailsElement).open) {
      const summary = el.querySelector(':scope > summary');
      if (summary) walk(summary);
      return;
    }
    if (tag === 'BR') {
      add('\n', null);
      return;
    }
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt')?.trim();
      if (alt) add(` ${alt} `, null);
      return;
    }
    const block = BLOCK.test(tag);
    if (block) breakLine();
    el.childNodes.forEach(walk);
    if (block) breakLine();
  };
  walk(root);
  return { text, segments };
}

export interface SpeechChunk {
  start: number;
  end: number;
}

/** Longest chunk handed to one utterance; Chrome stops long ones midway. */
const MAX_CHUNK = 220;

/**
 * Sentences of `text` as offset ranges, skipping blank ones. Long sentences
 * are cut at a comma or space so no utterance gets too long.
 */
export function splitSentences(text: string, locale?: string): SpeechChunk[] {
  const raw: SpeechChunk[] = [];
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ index: number; segment: string }> } }).Segmenter;
  if (Segmenter) {
    for (const { index, segment } of new Segmenter(locale, { granularity: 'sentence' }).segment(text)) {
      raw.push({ start: index, end: index + segment.length });
    }
  } else {
    const re = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0]) break;
      raw.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  // Line breaks end a sentence too (headings, list items, table rows).
  const lines: SpeechChunk[] = [];
  for (const chunk of raw) {
    let start = chunk.start;
    for (let i = chunk.start; i < chunk.end; i++) {
      if (text[i] === '\n') {
        lines.push({ start, end: i });
        start = i + 1;
      }
    }
    lines.push({ start, end: chunk.end });
  }
  const out: SpeechChunk[] = [];
  for (const chunk of lines) {
    let { start } = chunk;
    while (chunk.end - start > MAX_CHUNK) {
      const window = text.slice(start, start + MAX_CHUNK);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
      const at = cut > MAX_CHUNK / 3 ? cut + 1 : Math.max(window.lastIndexOf(' '), MAX_CHUNK / 2);
      out.push({ start, end: start + at });
      start += at;
    }
    out.push({ start, end: chunk.end });
  }
  // Trim whitespace and drop chunks with nothing to say.
  return out
    .map(({ start, end }) => {
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      return { start, end };
    })
    .filter(({ start, end }) => end > start && /[\p{L}\p{N}]/u.test(text.slice(start, end)));
}

/** A DOM range over the text between two offsets, or null if none of it is page text. */
export function rangeForOffsets(speech: SpeechText, start: number, end: number): Range | null {
  let first: { node: Text; offset: number } | null = null;
  let last: { node: Text; offset: number } | null = null;
  for (const seg of speech.segments) {
    if (!seg.node || seg.end <= start || seg.start >= end) continue;
    if (!first) first = { node: seg.node, offset: Math.max(0, start - seg.start) };
    last = { node: seg.node, offset: Math.min(seg.end, end) - seg.start };
  }
  if (!first || !last) return null;
  const range = first.node.ownerDocument.createRange();
  try {
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
  } catch {
    return null;
  }
  return range;
}

/** End of the word starting at `index`, for browsers whose boundary events carry no length. */
export function wordEnd(text: string, index: number): number {
  const match = /^[^\s]+/.exec(text.slice(index));
  return index + (match ? match[0].length : 0);
}

export const SENTENCE_HIGHLIGHT = 'bulwark-read-aloud-sentence';
export const WORD_HIGHLIGHT = 'bulwark-read-aloud-word';
const HIGHLIGHT_STYLE = `::highlight(${SENTENCE_HIGHLIGHT}){background-color:rgba(255,213,0,.35);color:inherit}::highlight(${WORD_HIGHLIGHT}){background-color:#ffd500;color:#000}`;

interface HighlightWindow {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => unknown;
}

/**
 * Marks `range` with a CSS custom highlight in its own document (a message
 * frame has its own registry). Does nothing where the browser has no
 * Highlight API; null clears it.
 */
export function setSpeechHighlight(doc: Document, name: string, range: Range | null): void {
  const win = doc.defaultView as unknown as HighlightWindow | null;
  const registry = win?.CSS?.highlights;
  if (!registry || !win?.Highlight) return;
  if (!doc.head.querySelector('style[data-bulwark-read-aloud]')) {
    const style = doc.createElement('style');
    style.setAttribute('data-bulwark-read-aloud', '');
    style.textContent = HIGHLIGHT_STYLE;
    doc.head.appendChild(style);
  }
  if (range) registry.set(name, new win.Highlight(range));
  else registry.delete(name);
}

/**
 * The voice for `wanted` (a voiceURI or name) among the browser's voices, or
 * null for the browser default.
 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], wanted: string): SpeechSynthesisVoice | null {
  if (!wanted) return null;
  return voices.find((v) => v.voiceURI === wanted) ?? voices.find((v) => v.name === wanted) ?? null;
}

/** The browser's voices that speak `locale` ("de" matches "de-DE", "de-AT"). */
export function voicesForLocale(voices: readonly SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice[] {
  const primary = locale.toLowerCase().split(/[-_]/)[0];
  return voices
    .filter((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === primary)
    .sort((a, b) => a.name.localeCompare(b.name));
}
