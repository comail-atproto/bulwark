import sharp from 'sharp';

/**
 * BIMI indicators are SVG Tiny Portable/Secure (draft-svg-tiny-ps-abrotman):
 * no script, no animation, nothing loaded from elsewhere. The browser never
 * gets the sender's SVG: it is checked here and drawn to a PNG, so whatever
 * the checks miss can't run or call out on the webmail origin anyway.
 */

/** The size the BIMI Group recommends as the ceiling for a self-published logo. */
export const MAX_SELF_ASSERTED_BYTES = 32 * 1024;
/** Mark certificates carry larger logos now and then; the CA checked those. */
export const MAX_CERTIFIED_BYTES = 64 * 1024;
/** Avatars are at most 48 CSS px; this covers 4x screens. */
export const INDICATOR_SIZE = 192;

const FORBIDDEN_ELEMENTS = new Set([
  'script', 'foreignobject', 'image', 'iframe', 'video', 'audio', 'canvas', 'embed', 'object',
  'animate', 'animatemotion', 'animatetransform', 'animatecolor', 'set', 'discard', 'handler', 'listener',
]);

export interface SvgCheckOptions {
  /**
   * Hold the logo to the profile itself: baseProfile="tiny-ps", a title and
   * the size ceiling. For self-published logos; a mark certificate's logo was
   * checked by the CA that issued it.
   */
  strictProfile: boolean;
}

function attributesOf(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out.set(m[1].toLowerCase(), m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Why the SVG can't be shown, or null when it can. */
export function checkSvg(svg: string, { strictProfile }: SvgCheckOptions): string | null {
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > (strictProfile ? MAX_SELF_ASSERTED_BYTES : MAX_CERTIFIED_BYTES)) return 'too large';
  // Entities can expand without bound or pull in files.
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) return 'doctype';

  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return 'not svg';
  const rootAttributes = attributesOf(root[0]);

  for (const m of svg.matchAll(/<\s*([\w:.-]+)/g)) {
    const name = m[1].toLowerCase().replace(/^[\w.-]+:/, '');
    if (FORBIDDEN_ELEMENTS.has(name)) return `forbidden element <${name}>`;
  }
  for (const m of svg.matchAll(/<[^>]+>/g)) {
    for (const [name, value] of attributesOf(m[0])) {
      if (/^on/.test(name)) return 'event handler';
      if ((name === 'href' || name.endsWith(':href')) && !value.trim().startsWith('#')) return 'external reference';
    }
  }
  // url(...) in attributes and style sheets may only point inside the document.
  for (const m of svg.matchAll(/url\(\s*['"]?\s*([^)'"\s]*)/gi)) {
    if (!m[1].startsWith('#')) return 'external reference';
  }
  if (/@import/i.test(svg)) return 'external reference';

  const viewBox = rootAttributes.get('viewbox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && viewBox.length === 4) {
    const [, , width, height] = viewBox;
    if (!(width > 0 && height > 0)) return 'empty viewBox';
    if (Math.abs(width - height) / Math.max(width, height) > 0.01) return 'not square';
  }

  if (strictProfile) {
    if (rootAttributes.get('baseprofile')?.toLowerCase() !== 'tiny-ps') return 'not tiny-ps';
    if (!/<title\b[^>]*>[^<]*\S[^<]*<\/title>/i.test(svg)) return 'no title';
    // The profile forbids positioning the root element.
    if (rootAttributes.has('x') || rootAttributes.has('y')) return 'positioned root';
  }
  return null;
}

/** Draw the SVG to a square PNG of INDICATOR_SIZE pixels. */
export async function rasterize(svg: string): Promise<Buffer> {
  const input = Buffer.from(svg, 'utf8');
  // librsvg draws at 72 dpi from the intrinsic size; raise the density so a
  // small viewBox isn't scaled up blurred, and cap it so a huge one doesn't
  // allocate a giant canvas.
  const meta = await sharp(input).metadata();
  const intrinsic = Math.max(1, Math.min(meta.width ?? INDICATOR_SIZE, meta.height ?? INDICATOR_SIZE));
  const density = Math.max(1, Math.min(2400, Math.ceil((72 * INDICATOR_SIZE) / intrinsic)));
  return sharp(input, { density, limitInputPixels: 4096 * 4096 })
    .resize(INDICATOR_SIZE, INDICATOR_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
