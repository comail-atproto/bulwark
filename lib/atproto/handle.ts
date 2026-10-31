/**
 * Public, unauthenticated lookups: waow supplies account suggestions and the
 * Bluesky AppView resolves handles before OAuth. Failed lookups never block
 * manual entry; the relay resolves the submitted identity authoritatively.
 */

export const APPVIEW_BASE = "https://public.api.bsky.app";
const TYPEAHEAD_ENDPOINT =
  "https://typeahead.waow.tech/xrpc/tech.waow.typeahead.searchActors";

/**
 * Default bound on every public lookup. A stalled service must not leave the
 * login submit stuck in the atprotoResolving spinner (or hang a typeahead
 * lookup) indefinitely; ~4s is long enough for a normal resolveHandle round-trip
 * yet short enough that a user who typed a handle is not left waiting. Both
 * resolveHandle and searchActorsTypeahead treat a timeout the same as any other
 * transient upstream fault: fail open.
 */
export const APPVIEW_TIMEOUT_MS = 4000;

export interface ActorSuggestion {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export type ResolveResult =
  | { status: "resolved"; did: string }
  | { status: "invalid" }
  | { status: "unknown" };

/** Options shared by every AppView lookup. */
export interface AtprotoLookupOptions {
  /**
   * Caller-owned cancellation signal (e.g. a combobox's per-keystroke
   * AbortController). When combined with the built-in timeout, caller abort
   * still wins: aborting this signal aborts the combined signal immediately.
   */
  signal?: AbortSignal;
  /** Override the default request timeout. Intended for tests. */
  timeoutMs?: number;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException
      ? err.name === "AbortError"
      : Boolean(err && typeof err === "object" && (err as { name?: string }).name === "AbortError")
  );
}

/**
 * Build a single AbortSignal that fires when EITHER the caller's signal aborts
 * OR the timeout elapses. Both `AbortSignal.any` and `AbortSignal.timeout` are
 * available in the supported runtimes (Node 22+ / evergreen browsers / jsdom 28).
 * Returns the caller's signal unchanged when no timeout applies, and `undefined`
 * when neither is supplied so `fetch` is called with no init.
 */
function withTimeout(options: AtprotoLookupOptions | undefined): AbortSignal | undefined {
  const timeoutMs = options?.timeoutMs ?? APPVIEW_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = options?.signal;
  if (!callerSignal) return timeoutSignal;
  return AbortSignal.any([callerSignal, timeoutSignal]);
}

/**
 * Accept either the modern options object or a bare AbortSignal (the
 * typeahead hook historically passed a signal positionally) and normalize to
 * the options shape so the timeout always applies.
 */
function normalizeOptions(
  options: AtprotoLookupOptions | AbortSignal | undefined,
): AtprotoLookupOptions | undefined {
  if (!options) return undefined;
  if (options instanceof AbortSignal) return { signal: options };
  return options;
}

/** Trim, strip a single leading `@`, and lowercase. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Cheap client-side sniff: a plausible handle has a dot (domain form) or is a
 * raw `did:` we can pass straight through. This is intentionally permissive -
 * the AppView is the real authority - and only exists to avoid firing network
 * requests for obviously-incomplete input.
 */
export function looksLikeHandle(value: string): boolean {
  const v = normalizeHandle(value);
  if (!v) return false;
  if (v.startsWith("did:")) return true;
  return v.includes(".") && !v.endsWith(".");
}

/**
 * Debounced-typeahead source. Returns actor suggestions for the typed prefix,
 * or an empty list on any non-abort failure (fail-open). AbortErrors (including
 * the built-in timeout firing) are re-thrown so callers can tell cancellation
 * apart from "no results"; the combobox hook swallows those and leaves its
 * state untouched.
 */
export async function searchActorsTypeahead(
  query: string,
  options?: AtprotoLookupOptions | AbortSignal,
): Promise<ActorSuggestion[]> {
  const q = normalizeHandle(query);
  if (!q) return [];

  const url = new URL(TYPEAHEAD_ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");

  const signal = withTimeout(normalizeOptions(options));

  try {
    const res = await fetch(url.toString(), {
      signal,
      credentials: "omit",
      headers: { Accept: "application/json", "X-Client": "comail.at" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { actors?: ActorSuggestion[] };
    return Array.isArray(body.actors) ? body.actors : [];
  } catch (err) {
    if (isAbortError(err)) throw err;
    return [];
  }
}

/**
 * Pre-validate a handle before redirecting to OAuth.
 *
 * - `resolved`: the AppView returned a DID (or the input was already a raw did).
 * - `invalid`: the AppView actively rejected the handle (4xx). The caller
 *   should show an inline error and block the redirect.
 * - `unknown`: the AppView was unreachable, errored (5xx/network), or the
 *   built-in timeout fired. The caller should fail open and allow the plain
 *   submit; a non-bsky PDS handle also lands here and must not be blocked.
 *
 * The request is bounded by `APPVIEW_TIMEOUT_MS` (overridable via `timeoutMs`,
 * primarily for tests) so a stalled appview cannot leave the caller stuck in
 * its resolving spinner forever. A timeout is a transient upstream fault and
 * fails open to `unknown` rather than throwing.
 */
export async function resolveHandle(
  handle: string,
  options?: AtprotoLookupOptions | AbortSignal,
): Promise<ResolveResult> {
  const h = normalizeHandle(handle);
  if (!h) return { status: "invalid" };
  // A raw DID needs no resolution - forward it as-is.
  if (h.startsWith("did:")) return { status: "resolved", did: h };

  const url = new URL("/xrpc/com.atproto.identity.resolveHandle", APPVIEW_BASE);
  url.searchParams.set("handle", h);

  const signal = withTimeout(normalizeOptions(options));

  let res: Response;
  try {
    res = await fetch(url.toString(), signal ? { signal } : undefined);
  } catch {
    // A timeout or caller abort is a transient/cancellation fault, not a
    // positive rejection of the handle. Network failures land here too.
    // Both fail open so a reachable-PDS login still proceeds.
    return { status: "unknown" };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as { did?: string };
      if (body.did) return { status: "resolved", did: body.did };
    } catch {
      /* malformed body - treat as unknown below */
    }
    return { status: "unknown" };
  }

  // 4xx: the AppView positively knows this handle. Block the redirect.
  // 5xx: transient upstream fault - fail open.
  if (res.status >= 400 && res.status < 500) return { status: "invalid" };
  return { status: "unknown" };
}
