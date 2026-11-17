/**
 * Just enough DER to read the parts of a mark certificate and its CRL that
 * node:crypto's X509Certificate doesn't expose: extensions by OID, the
 * logotype's data: URI and the serial numbers of a certificate list.
 * Definite lengths only, as DER requires.
 */

export interface DerNode {
  tag: number;
  /** Offset of the tag byte in the buffer. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset just past the content. */
  end: number;
}

export class DerError extends Error {}

export function readNode(buf: Uint8Array, offset: number, limit = buf.length): DerNode {
  if (offset + 2 > limit) throw new DerError('truncated');
  const tag = buf[offset];
  // Multi-byte tag numbers never occur in certificates.
  if ((tag & 0x1f) === 0x1f) throw new DerError('long tag');
  let length = buf[offset + 1];
  let contentStart = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || contentStart + count > limit) throw new DerError('bad length');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buf[contentStart + i];
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > limit) throw new DerError('truncated');
  return { tag, start: offset, contentStart, end };
}

/** The children of a constructed node. */
export function children(buf: Uint8Array, node: DerNode): DerNode[] {
  if (!(node.tag & 0x20)) throw new DerError('not constructed');
  const out: DerNode[] = [];
  let offset = node.contentStart;
  while (offset < node.end) {
    const child = readNode(buf, offset, node.end);
    out.push(child);
    offset = child.end;
  }
  return out;
}

export function content(buf: Uint8Array, node: DerNode): Uint8Array {
  return buf.subarray(node.contentStart, node.end);
}

/** The whole encoding of a node, tag and length included. */
export function encoding(buf: Uint8Array, node: DerNode): Uint8Array {
  return buf.subarray(node.start, node.end);
}

export function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new DerError('empty oid');
  const parts: number[] = [];
  let value = 0;
  for (const byte of bytes) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  const first = parts.shift()!;
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...head, ...parts].join('.');
}

/**
 * A serial number as upper-case hex without leading zeros. X509Certificate
 * keeps whole bytes ("0BADC0DE"), DER may add a zero byte for the sign, so
 * both sides go through this before they are compared.
 */
export function normalizeSerial(hex: string): string {
  return hex.toUpperCase().replace(/^0+(?=.)/, '');
}

/** An INTEGER as a normalized serial (see normalizeSerial). */
export function integerHex(bytes: Uint8Array): string {
  return normalizeSerial(Buffer.from(bytes).toString('hex'));
}

const TAG_SEQUENCE = 0x30;
const TAG_OID = 0x06;
const TAG_BOOLEAN = 0x01;
const TAG_OCTET_STRING = 0x04;
const TAG_EXTENSIONS = 0xa3;

/**
 * The extnValue contents of every extension of a certificate, by OID.
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature },
 * and the extensions are the [3] field of tbsCertificate.
 */
export function certificateExtensions(der: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const cert = readNode(der, 0);
  if (cert.tag !== TAG_SEQUENCE) throw new DerError('not a certificate');
  const [tbs] = children(der, cert);
  if (!tbs || tbs.tag !== TAG_SEQUENCE) throw new DerError('no tbsCertificate');
  const wrapper = children(der, tbs).find((node) => node.tag === TAG_EXTENSIONS);
  if (!wrapper) return out;
  const [list] = children(der, wrapper);
  if (!list || list.tag !== TAG_SEQUENCE) throw new DerError('bad extensions');
  for (const extension of children(der, list)) {
    const parts = children(der, extension);
    const oid = parts[0];
    const value = parts.find((node, i) => i > 0 && node.tag === TAG_OCTET_STRING);
    if (oid?.tag !== TAG_OID || !value) continue;
    // A boolean (critical) may sit between the two.
    if (parts.length > 3 || (parts.length === 3 && parts[1].tag !== TAG_BOOLEAN)) continue;
    out.set(decodeOid(content(der, oid)), content(der, value));
  }
  return out;
}

/** Every primitive node with `tag` anywhere below `node`, in order. */
export function findAll(buf: Uint8Array, node: DerNode, tag: number, out: DerNode[] = [], depth = 0): DerNode[] {
  if (depth > 32) throw new DerError('too deep');
  if (node.tag === tag) {
    out.push(node);
    return out;
  }
  if (node.tag & 0x20) {
    for (const child of children(buf, node)) findAll(buf, child, tag, out, depth + 1);
  }
  return out;
}

/** The text of every string with `tag` (IA5String 0x16, a [6] URI 0x86) inside an extension value. */
export function stringsIn(value: Uint8Array, tag: number): string[] {
  const root = readNode(value, 0);
  return findAll(value, root, tag).map((node) => Buffer.from(content(value, node)).toString('latin1'));
}
