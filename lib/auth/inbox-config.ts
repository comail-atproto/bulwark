// Historical environment names remain accepted for released deployments.
// Conflicting old/new values fail closed instead of choosing another authority.
export function inboxSetting(canonical: string, historical: string): string | null | undefined {
  const owned = process.env[canonical];
  const legacy = process.env[historical];
  if (owned !== undefined && legacy !== undefined && owned !== legacy) return null;
  return owned ?? legacy;
}

export function inboxBridgeSecret(): string | null {
  const secret = inboxSetting('BULWARK_INBOX_SSO_SECRET', 'BULWARK_RELAY_SSO_SECRET');
  return secret && secret.length >= 32 ? secret : null;
}

export function calendarBridgeEndpoint(): string {
  return inboxBridgeEndpoint('INBOX_CALENDAR_BRIDGE_URL', 'RELAY_CALENDAR_BRIDGE_URL');
}

export function inboxBridgeEndpoint(canonical: string, historical: string): string {
  const raw = inboxSetting(canonical, historical);
  if (!raw || [...raw].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f)) return '';
  try {
    const url = new URL(raw);
    const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !loopback) || !url.hostname || url.username || url.password || url.href.includes('?') || url.href.includes('#')) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function bridgeFailureClass(error: unknown): string {
  return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'transport';
}
