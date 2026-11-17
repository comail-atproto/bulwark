import { apiFetch } from '@/lib/browser-navigation';
import { buildMobileHandoffCodeUrl } from '@/lib/auth/mobile-handoff';

/**
 * Park a password sign-in for the mobile app (/api/auth/handoff/create) and
 * return the app link that carries only the one-time code. Null when the
 * server would not take it; the caller must not fall back to putting the
 * password in the link, which is what the app's challenge asked to avoid.
 */
export async function requestMobileHandoffCodeUrl(opts: {
  target: string;
  challenge: string;
  state: string;
  payload: { server_url: string; username: string; password: string };
}): Promise<string | null> {
  try {
    const res = await apiFetch('/api/auth/handoff/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code_challenge: opts.challenge, state: opts.state, ...opts.payload }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { code?: unknown } | null;
    if (typeof data?.code !== 'string' || !data.code) return null;
    return buildMobileHandoffCodeUrl(opts.target, data.code, opts.state);
  } catch {
    return null;
  }
}

/**
 * Confirm an SSO hand-off the server parked (/api/auth/handoff/confirm) and
 * return the app link with its code. Null when the code is gone (it waited
 * too long); the user has to start the sign-in in the app again.
 */
export async function confirmMobileHandoffCodeUrl(opts: {
  target: string;
  code: string;
  state: string;
}): Promise<string | null> {
  try {
    const res = await apiFetch('/api/auth/handoff/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: opts.code }),
    });
    if (!res.ok) return null;
    return buildMobileHandoffCodeUrl(opts.target, opts.code, opts.state);
  } catch {
    return null;
  }
}
