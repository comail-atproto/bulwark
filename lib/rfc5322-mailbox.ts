/**
 * Parsing helpers for RFC 5322 mailboxes (`Display Name <addr@example.com>`).
 *
 * Address data reaches us from places that do not keep the display name and
 * the address apart: vCard `FN` fields that hold the whole mailbox, Sent-folder
 * headers, `Identity.name` on some servers. Handing such a string back to a
 * server as a structured display name produces a doubled, invalid mailbox
 * (`"Jane <j@x.com>" <j@x.com>`), which mail servers then re-parse into a
 * broken envelope recipient (#672). These helpers reduce any of those forms to
 * a clean name/address pair.
 */

/** Strips a surrounding quoted-string (and its escapes) from a display name. */
export function unquoteDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1').trim();
  }
  return trimmed;
}

/**
 * Reduces a display name to just the name: unquotes it and drops an address it
 * carries inline, whether or not the angle brackets are balanced
 * (`Jane <j@x.com>`, `Jane<j@x.com` → `Jane`).
 */
export function sanitizeDisplayName(name: string | undefined | null): string {
  if (!name) return '';
  return unquoteDisplayName(unquoteDisplayName(name).replace(/\s*<[^<>]*>?\s*$/, ''));
}

/** The addr-spec a mailbox string carries, or '' when it has none. */
function extractAddrSpec(value: string): string {
  // Prefer the last angle-bracketed run - a display name that embeds an
  // address puts an earlier, redundant copy in front of the real one. The
  // closing bracket is optional so a truncated `Jane<j@x.com` still resolves.
  const angle = value.match(/<([^<>]*)>?\s*$/);
  if (angle) return angle[1].trim();
  // No brackets: the whole string is the address, if it looks like one at all.
  return value.includes('@') ? value : '';
}

/**
 * Splits an RFC 5322 mailbox into its display name and addr-spec. Accepts the
 * malformed shapes above; the returned name never contains an address and the
 * returned email is always a bare addr-spec. `name` is omitted when there is
 * no display name distinct from the address.
 */
export function splitMailbox(value: string): { name?: string; email: string } {
  const trimmed = value.trim();
  const email = extractAddrSpec(trimmed);
  if (!email) return { email: trimmed };

  // Everything ahead of the address is the display name.
  const nameSource = trimmed.slice(0, trimmed.lastIndexOf(email)).replace(/<\s*$/, '');
  const name = sanitizeDisplayName(nameSource);
  return name && name !== email ? { name, email } : { email };
}
