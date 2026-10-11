/**
 * Resolve an atproto (Bluesky) account's public profile for the account UI.
 *
 * The logged-in member's DID is fetched against the PUBLIC appview
 * (`app.bsky.actor.getProfile`), which requires no authentication. The result
 * is cached module-level so the handle and avatar consumers share one request,
 * and concurrent renders share a single in-flight request.
 *
 * Design constraints (see issue #1767):
 *   - Public appview only. No auth header, no other hosts.
 *   - Fail-open: any network / parse / HTTP error resolves to `null` so the
 *     caller falls back to initials. Never throws, never blocks login.
 *   - Cache the result (including failures and profiles without an avatar) so
 *     we do not refetch per render.
 */

const PUBLIC_APPVIEW_BASE = "https://public.api.bsky.app";
const GET_PROFILE_PATH = "/xrpc/app.bsky.actor.getProfile";

export interface AtprotoProfile {
  did: string;
  handle: string | null;
  avatar: string | null;
}

// did -> resolved public profile (or null on failure). Avatar and handle
// consumers share this cache and the same in-flight request.
const profileCache = new Map<string, AtprotoProfile | null>();
const inFlight = new Map<string, Promise<AtprotoProfile | null>>();

function isSupportedDid(did: string): boolean {
  // atproto DIDs are did:plc:* or did:web:*. Reject anything else so we never
  // send arbitrary caller-controlled strings to the appview.
  return did.startsWith("did:plc:") || did.startsWith("did:web:");
}

/**
 * Resolve the public atproto profile for a DID. Returns the current handle and
 * avatar URL, or `null` when the DID is unsupported or the fetch fails. A
 * profile without an avatar is still returned so handle-only accounts render.
 */
export async function resolveAtprotoProfile(did: string): Promise<AtprotoProfile | null> {
  if (!did || !isSupportedDid(did)) return null;

  if (profileCache.has(did)) {
    return profileCache.get(did) ?? null;
  }
  const existing = inFlight.get(did);
  if (existing) return existing;

  const url =
    `${PUBLIC_APPVIEW_BASE}${GET_PROFILE_PATH}?actor=${encodeURIComponent(did)}`;

  const request = (async (): Promise<AtprotoProfile | null> => {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { handle?: unknown; avatar?: unknown };
      const handle =
        typeof data.handle === "string" && data.handle.trim().length > 0
          ? data.handle.trim().replace(/^@/, "")
          : null;
      const avatar = typeof data.avatar === "string" ? data.avatar : null;
      return {
        did,
        handle,
        avatar: avatar && avatar.length > 0 ? avatar : null,
      };
    } catch {
      // Fail-open: network error, abort, or malformed JSON.
      return null;
    }
  })();

  inFlight.set(did, request);
  try {
    const result = await request;
    profileCache.set(did, result);
    return result;
  } finally {
    inFlight.delete(did);
  }
}

/**
 * Compatibility wrapper for avatar consumers. It shares the profile cache, so
 * rendering a handle and avatar for the same account performs one request.
 */
export async function resolveAtprotoAvatar(did: string): Promise<string | null> {
  return (await resolveAtprotoProfile(did))?.avatar ?? null;
}

/** Test-only: reset the module caches between cases. */
export function __resetAtprotoAvatarCacheForTests(): void {
  profileCache.clear();
  inFlight.clear();
}
