import { describe, it, expect } from 'vitest';
import { decodeFileNodeName } from '../jmap/filenode-name';

// Stalwart stores the raw percent-encoded path segment as the FileNode name
// when a node is created over WebDAV (#869). Verified against Stalwart 0.16:
// MKCOL .../Spares%20Catalog%20%D8%B9%D8%B1%D8%A8%D9%8A/ -> FileNode/get
// returns name "Spares%20Catalog%20%D8%B9%D8%B1%D8%A8%D9%8A".
describe('decodeFileNodeName', () => {
  it('decodes spaces from WebDAV-created names', () => {
    expect(decodeFileNodeName('Spares%20Catalog')).toBe('Spares Catalog');
  });

  it('decodes UTF-8 escapes (Arabic)', () => {
    expect(decodeFileNodeName('Spares%20Catalog%20%D8%B9%D8%B1%D8%A8%D9%8A')).toBe('Spares Catalog عربي');
  });

  it('decodes other reserved characters', () => {
    expect(decodeFileNodeName('Q%26A%20%5Bfinal%5D%20%2B%20notes%3F.txt')).toBe('Q&A [final] + notes?.txt');
    expect(decodeFileNodeName('100%25.txt')).toBe('100%.txt');
  });

  it('leaves names without escapes untouched', () => {
    expect(decodeFileNodeName('Spares Catalog')).toBe('Spares Catalog');
    expect(decodeFileNodeName('عربي.pdf')).toBe('عربي.pdf');
    expect(decodeFileNodeName('')).toBe('');
  });

  it('leaves a literal percent sign that is not an escape alone', () => {
    expect(decodeFileNodeName('100% done.txt')).toBe('100% done.txt');
    expect(decodeFileNodeName('50%.txt')).toBe('50%.txt');
    expect(decodeFileNodeName('%')).toBe('%');
  });

  it('keeps the raw name when decoding fails or would produce a path', () => {
    // Valid-looking escape followed by a truncated UTF-8 sequence -> URIError.
    expect(decodeFileNodeName('bad%20%D8')).toBe('bad%20%D8');
    // "%2F" would decode to "/", turning a name into a path.
    expect(decodeFileNodeName('a%2Fb')).toBe('a%2Fb');
    expect(decodeFileNodeName('a%00b')).toBe('a%00b');
  });
});
