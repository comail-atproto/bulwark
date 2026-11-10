/**
 * HTML mail as plain text, for "show as plain text" when a message has no
 * text/plain part of its own, and for read aloud and the reader view.
 *
 * Layout tables become lines, headings and paragraphs keep a blank line
 * around them, list items get a bullet, images are replaced by their alt text
 * and a link keeps its target in brackets after its text, so nothing the
 * formatted mail offered is lost.
 */

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CENTER', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
]);
/** Blocks that get a blank line before and after, not just a line break. */
const PARAGRAPH = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'HR']);
const SKIP = new Set(['HEAD', 'STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'META', 'LINK', 'SVG', 'OBJECT', 'IFRAME']);

/** Link targets worth writing out: web, mail and phone links. */
function shownHref(href: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (/^mailto:/i.test(trimmed)) return trimmed.slice(7).split('?')[0] || null;
  if (/^(https?:|tel:)/i.test(trimmed)) return trimmed;
  return null;
}

function normalize(text: string): string {
  return text.replace(/[ \t\f\v\r\n\u00a0]+/g, ' ');
}

/** Same address once with and once without the scheme or a trailing slash. */
function sameTarget(text: string, href: string): boolean {
  const strip = (s: string) => s.trim().toLowerCase().replace(/^(https?:\/\/|mailto:|tel:)/, '').replace(/\/$/, '');
  return strip(text) === strip(href);
}

export function htmlToReadableText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  // Pending line breaks, so runs of empty blocks collapse to one blank line.
  let pendingBreaks = 0;
  let atLineStart = true;

  const breakLine = (count: number) => {
    if (out.length === 0) return;
    pendingBreaks = Math.max(pendingBreaks, count);
  };
  const write = (text: string) => {
    if (!text) return;
    if (pendingBreaks > 0) {
      out.push('\n'.repeat(pendingBreaks));
      pendingBreaks = 0;
      atLineStart = true;
    }
    if (atLineStart) text = text.replace(/^ +/, '');
    if (!text) return;
    out.push(text);
    atLineStart = text.endsWith('\n');
  };

  const walk = (node: Node, pre: boolean, listDepth: number) => {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? '';
      write(pre ? value : normalize(value));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if ((el as HTMLElement).hidden || /display\s*:\s*none/i.test(el.getAttribute('style') ?? '')) return;

    if (tag === 'BR') {
      out.push('\n');
      pendingBreaks = 0;
      atLineStart = true;
      return;
    }
    if (tag === 'IMG' || (tag === 'INPUT' && el.getAttribute('type') === 'image')) {
      const alt = normalize(el.getAttribute('alt') ?? '').trim();
      if (alt) write(`[${alt}]`);
      return;
    }
    if (tag === 'HR') {
      breakLine(2);
      write('---');
      breakLine(2);
      return;
    }

    const isBlock = BLOCK.has(tag);
    const gap = PARAGRAPH.has(tag) && !(tag === 'UL' || tag === 'OL') ? 2 : 1;
    if (isBlock) breakLine(listDepth > 0 && (tag === 'UL' || tag === 'OL') ? 1 : gap);
    if (tag === 'LI') write(`${'  '.repeat(Math.max(0, listDepth - 1))}• `);
    if (tag === 'TD' || tag === 'TH') {
      if (!atLineStart && pendingBreaks === 0) write(' ');
    }
    if (tag === 'BLOCKQUOTE') write('> ');

    const childPre = pre || tag === 'PRE';
    const childDepth = tag === 'UL' || tag === 'OL' ? listDepth + 1 : listDepth;
    const start = out.length;
    el.childNodes.forEach((child) => walk(child, childPre, childDepth));

    if (tag === 'A') {
      const href = shownHref(el.getAttribute('href'));
      const text = out.slice(start).join('').trim();
      if (href && !sameTarget(text, href)) write(text ? ` (${href})` : href);
    }
    if (isBlock) breakLine(tag === 'LI' ? 1 : gap);
  };

  walk(doc.body, false, 0);
  return out
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
