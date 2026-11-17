// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { checkSvg, rasterize, INDICATOR_SIZE } from '@/lib/bimi/svg';

const svg = (body: string, root = 'version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${root}><title>Brand</title>${body}</svg>`;
const strict = { strictProfile: true };
const lenient = { strictProfile: false };

describe('checkSvg', () => {
  it('accepts a Tiny PS logo', () => {
    expect(checkSvg(svg('<rect width="100" height="100" fill="#0a6"/>'), strict)).toBeNull();
  });

  it('refuses scripts, event handlers and foreign content', () => {
    expect(checkSvg(svg('<script>alert(1)</script>'), lenient)).toMatch(/script/);
    expect(checkSvg(svg('<rect width="1" height="1" onclick="alert(1)"/>'), lenient)).toBe('event handler');
    expect(checkSvg(svg('<foreignObject><div/></foreignObject>'), lenient)).toMatch(/foreignobject/);
    expect(checkSvg(svg('<animate attributeName="x"/>'), lenient)).toMatch(/animate/);
  });

  it('refuses anything loaded from elsewhere', () => {
    expect(checkSvg(svg('<use xlink:href="https://tracker.example/a.svg#x"/>'), lenient)).toBe('external reference');
    expect(checkSvg(svg('<rect fill="url(https://tracker.example/p)"/>'), lenient)).toBe('external reference');
    expect(checkSvg(svg('<style>@import "https://tracker.example/s.css";</style>'), lenient)).toBe('external reference');
    // References inside the document are fine.
    expect(checkSvg(svg('<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/>'), lenient)).toBeNull();
  });

  it('refuses entity declarations', () => {
    expect(checkSvg(`<!DOCTYPE svg [<!ENTITY a "aaaa">]>${svg('<rect/>')}`, lenient)).toBe('doctype');
  });

  it('refuses a logo that isn\'t square', () => {
    expect(checkSvg(svg('<rect/>', 'version="1.2" baseProfile="tiny-ps" viewBox="0 0 200 100"'), lenient)).toBe('not square');
  });

  it('holds self-published logos to the profile, certificate logos only to safety', () => {
    const plain = svg('<rect/>', 'viewBox="0 0 100 100"');
    expect(checkSvg(plain, strict)).toBe('not tiny-ps');
    expect(checkSvg(plain, lenient)).toBeNull();
    const big = svg(`<desc>${'x'.repeat(40 * 1024)}</desc>`);
    expect(checkSvg(big, strict)).toBe('too large');
    expect(checkSvg(big, lenient)).toBeNull();
  });
});

describe('rasterize', () => {
  it('draws a square PNG of the indicator size', async () => {
    const png = await rasterize(svg('<rect width="100" height="100" fill="#0a6"/>'));
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([INDICATOR_SIZE, INDICATOR_SIZE]);
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    // The fill colour, not an empty canvas.
    expect([data[0], data[1], data[2]]).toEqual([0x00, 0xaa, 0x66]);
  });
});
