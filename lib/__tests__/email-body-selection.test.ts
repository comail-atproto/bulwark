import { describe, it, expect } from 'vitest';
import { getRenderableHtmlBody } from '@/lib/email-body-selection';

type PartialEmail = Parameters<typeof getRenderableHtmlBody>[0];

function makeEmail(parts: {
  html?: { partId: string; type: string };
  text?: { partId: string; type: string };
  values: Record<string, string>;
}): PartialEmail {
  const part = (p: { partId: string; type: string }) => ({
    partId: p.partId,
    blobId: `blob-${p.partId}`,
    size: 1,
    type: p.type,
  });
  return {
    htmlBody: parts.html ? [part(parts.html)] : [],
    textBody: parts.text ? [part(parts.text)] : [],
    bodyValues: Object.fromEntries(
      Object.entries(parts.values).map(([k, v]) => [k, { value: v, isEncodingProblem: false, isTruncated: false }])
    ),
  } as PartialEmail;
}

describe('getRenderableHtmlBody', () => {
  it('renders as plain text when the shared part is text/plain (#489)', () => {
    // Plain-text-only mail: RFC 8621 puts the same part in htmlBody and textBody.
    const email = makeEmail({
      html: { partId: '1', type: 'text/plain' },
      text: { partId: '1', type: 'text/plain' },
      values: { '1': 'line one\nline two\nline three' },
    });

    expect(getRenderableHtmlBody(email)).toBeNull();
  });

  it('matches the media type case-insensitively', () => {
    const email = makeEmail({
      html: { partId: '1', type: 'TEXT/HTML' },
      text: { partId: '1', type: 'TEXT/HTML' },
      values: { '1': '<p>hello</p>' },
    });

    expect(getRenderableHtmlBody(email)).toBe('<p>hello</p>');
  });

  it('renders HTML-only mail as HTML even though the part is shared', () => {
    const email = makeEmail({
      html: { partId: '1', type: 'text/html' },
      text: { partId: '1', type: 'text/html' },
      values: { '1': '<div><b>rich</b> content</div>' },
    });

    expect(getRenderableHtmlBody(email)).toBe('<div><b>rich</b> content</div>');
  });

  it('prefers the distinct text part when the HTML alternative is a bare wrapper', () => {
    const email = makeEmail({
      html: { partId: '2', type: 'text/html' },
      text: { partId: '1', type: 'text/plain' },
      values: { '1': 'line one\nline two', '2': '<html><body>line one line two</body></html>' },
    });

    expect(getRenderableHtmlBody(email)).toBeNull();
  });

  it('keeps a distinct HTML alternative that carries real formatting', () => {
    const html = '<html><body><p>line one</p><p><b>line two</b></p></body></html>';
    const email = makeEmail({
      html: { partId: '2', type: 'text/html' },
      text: { partId: '1', type: 'text/plain' },
      values: { '1': 'line one\nline two', '2': html },
    });

    expect(getRenderableHtmlBody(email)).toBe(html);
  });

  it('returns null when there is no HTML body at all', () => {
    const email = makeEmail({
      text: { partId: '1', type: 'text/plain' },
      values: { '1': 'just text' },
    });

    expect(getRenderableHtmlBody(email)).toBeNull();
  });

  it('returns null when the HTML part has no fetched body value', () => {
    const email = makeEmail({
      html: { partId: '2', type: 'text/html' },
      text: { partId: '1', type: 'text/plain' },
      values: { '1': 'just text' },
    });

    expect(getRenderableHtmlBody(email)).toBeNull();
  });

  it('returns null for an empty HTML body value', () => {
    const email = makeEmail({
      html: { partId: '2', type: 'text/html' },
      text: { partId: '1', type: 'text/plain' },
      values: { '1': 'just text', '2': '' },
    });

    expect(getRenderableHtmlBody(email)).toBeNull();
  });
});
