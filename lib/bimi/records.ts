/**
 * The DNS side of BIMI: the assertion record at <selector>._bimi.<domain>
 * and the DMARC policy that has to back it. Pure parsing; lib/bimi/lookup.ts
 * does the queries.
 */

export interface BimiRecord {
  /** The indicator (SVG) location, https only. Undefined when the tag is empty or missing. */
  logoUrl?: string;
  /** The evidence document (mark certificate PEM) location, https only. */
  evidenceUrl?: string;
  /** l= and a= both empty: the domain asks for no indicator. */
  declined: boolean;
}

export type DmarcPolicy = 'none' | 'quarantine' | 'reject';

export interface DmarcRecord {
  p: DmarcPolicy;
  sp?: DmarcPolicy;
  pct: number;
}

function tags(record: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of record.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    if (name && !out.has(name)) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

function httpsUrl(value: string | undefined): string | undefined {
  // Early drafts allowed a comma-separated list; the first entry counts.
  const first = value?.split(',')[0]?.trim();
  if (!first) return undefined;
  try {
    const url = new URL(first);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isBimi(record: string): boolean {
  return /^v\s*=\s*BIMI1\s*(;|$)/i.test(record.trim());
}

function isDmarc(record: string): boolean {
  return /^v\s*=\s*DMARC1\s*(;|$)/i.test(record.trim());
}

/**
 * The one record that starts with `v=BIMI1` among the TXT answers. Zero or
 * several make it null: a domain with a wildcard TXT answers BIMI queries
 * with its SPF record, and two assertion records are an error.
 */
export function pickBimiRecord(answers: readonly string[]): BimiRecord | null {
  const records = answers.filter(isBimi);
  if (records.length !== 1) return null;
  const parsed = tags(records[0]);
  const logo = parsed.get('l') ?? '';
  const evidence = parsed.get('a') ?? '';
  const logoUrl = httpsUrl(logo);
  const evidenceUrl = httpsUrl(evidence);
  // A tag that names a non-https location is invalid, not a declination.
  if ((logo && !logoUrl) || (evidence && !evidenceUrl)) return null;
  return { logoUrl, evidenceUrl, declined: !logoUrl && !evidenceUrl };
}

function policy(value: string | undefined): DmarcPolicy | undefined {
  const lower = value?.toLowerCase();
  return lower === 'none' || lower === 'quarantine' || lower === 'reject' ? lower : undefined;
}

/** The one DMARC record among the TXT answers, or null. */
export function pickDmarcRecord(answers: readonly string[]): DmarcRecord | null {
  const records = answers.filter(isDmarc);
  if (records.length !== 1) return null;
  const parsed = tags(records[0]);
  const p = policy(parsed.get('p'));
  if (!p) return null;
  const pctText = parsed.get('pct');
  const pct = pctText === undefined ? 100 : Number(pctText);
  return { p, sp: policy(parsed.get('sp')), pct: Number.isInteger(pct) ? pct : 0 };
}

/**
 * Whether the published DMARC policy is strict enough for BIMI: quarantine
 * or reject for every message (pct=100), and for a subdomain an
 * organizational domain that isn't p=none either.
 *
 * `author` is the record at _dmarc.<author domain>, `organizational` the one
 * at _dmarc.<organizational domain>; pass the same record twice when they
 * are the same domain.
 */
export function dmarcAllowsBimi(
  author: DmarcRecord | null,
  organizational: DmarcRecord | null,
  isSubdomain: boolean,
): boolean {
  const applied = author ?? (isSubdomain ? organizational : null);
  if (!applied) return false;
  const effective = author ? author.p : (applied.sp ?? applied.p);
  if (effective === 'none' || applied.pct !== 100) return false;
  if (isSubdomain && organizational && organizational.p === 'none') return false;
  return true;
}
