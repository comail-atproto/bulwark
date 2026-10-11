function normalizeOrigin(value: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

const PARENT_ORIGIN = typeof window !== 'undefined'
  ? normalizeOrigin(document.querySelector('meta[name="parent-origin"]')?.getAttribute('content') || '')
  : null;

export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function notifyParent(type: string, payload: Record<string, unknown> = {}) {
  if (!isEmbedded()) return;
  // Refuse to broadcast when the parent origin is unknown. A wildcard
  // targetOrigin would leak the payload (e.g. username) to any frame
  // the parent has open.
  if (!PARENT_ORIGIN) return;

  try {
    window.parent.postMessage({ source: 'bulwark', type, ...payload }, PARENT_ORIGIN);
  } catch {
    // Cross-origin postMessage may fail in restricted contexts
  }
}

export function listenFromParent(
  handler: (msg: { type: string; [k: string]: unknown }) => void,
  allowedOrigin: string,
): () => void {
  // Reject installation entirely when the caller cannot pin an origin.
  // Without this gate any cross-origin frame could forge
  // { source: 'portal', type: 'sso:trigger-logout' } and ride the session.
  const normalized = normalizeOrigin(allowedOrigin);
  if (!normalized) {
    if (typeof console !== 'undefined') {
      console.error('[iframe-bridge] listenFromParent requires a valid http(s) allowedOrigin; listener not installed');
    }
    return () => {};
  }

  const listener = (event: MessageEvent) => {
    if (event.origin !== normalized) return;
    if (event.source !== window.parent) return;
    if (!event.data || event.data.source !== 'portal') return;

    handler(event.data);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
