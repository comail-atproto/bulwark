/**
 * Percent-decode a FileNode name that Stalwart stored in URI form.
 *
 * When a file or folder is created over WebDAV (rclone, WinSCP, Finder, ...),
 * Stalwart keeps the raw, percent-encoded path segment as the FileNode name -
 * "Spares Catalog" arrives as "Spares%20Catalog" and Arabic/other non-ASCII
 * names as UTF-8 escapes. WebDAV clients never notice because Stalwart echoes
 * that string back verbatim in <D:href> and they decode it, but JMAP
 * FileNode/get returns it as-is, so the Files tab showed "Spares%20Catalog"
 * (#869). Decode it here so the UI shows the human-readable name.
 *
 * Conservative on purpose: a name is only decoded when it contains at least
 * one valid %XX escape and decodes cleanly; a literal "%" in a JMAP-created
 * name ("100% done.txt") is left untouched. A decoded "/" would turn a name
 * into a path, so such names are also left alone.
 */
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/;

export function decodeFileNodeName(name: string): string {
  if (!PERCENT_ESCAPE.test(name)) return name;
  try {
    const decoded = decodeURIComponent(name);
    if (decoded.includes('/') || decoded.includes('\0')) return name;
    return decoded;
  } catch {
    return name;
  }
}
