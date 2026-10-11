/**
 * Shared constants and types for the plugin OAuth callback handoff.
 *
 * The callback page (`/[locale]/plugins/oauth/callback`) parks the provider's
 * payload in storage and dispatches events; the host relays it to plugins via
 * the `authHooks.onOAuthCallback` hook bus. Both sides share the storage key,
 * event name and payload contract from this module.
 */

export const PLUGIN_OAUTH_STORAGE_KEY = "plugin-oauth-callback";
export const PLUGIN_OAUTH_EVENT = "plugin-oauth-callback";

/**
 * Payload delivered to plugins through `authHooks.onOAuthCallback`.
 *
 * Two shapes, discriminated by which field the provider returned:
 * - Success: `{ code, state?, receivedAt? }`
 * - Denial/failure: `{ error, state?, error_description?, receivedAt? }`
 *
 * `state` stays optional in both variants because a provider may omit it even
 * on error; plugins match the flow against the verifier they stashed before
 * redirecting and ignore payloads whose `state` does not match. Narrow with
 * `'code' in payload` / `'error' in payload`.
 */
export type OAuthCallbackPayload =
    | { code: string; state?: string; receivedAt?: number }
    | {
        error: string;
        state?: string;
        error_description?: string;
        receivedAt?: number;
    };
