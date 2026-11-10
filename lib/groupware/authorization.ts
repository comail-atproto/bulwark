export function isPersonalAuthorizationUrl(value: unknown, kind: 'contacts' | 'files', expectedOrigin?: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && (expectedOrigin === undefined || url.origin === expectedOrigin)
      && new RegExp(`^/oauth/${kind}/tickets/[A-Za-z0-9_-]{43}$`).test(url.pathname);
  } catch {
    return false;
  }
}
