export const SESSION_COOKIE = 'jmap_session';
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Get the cookie name for a given account slot. Slot 0 uses the legacy name. */
export function sessionCookieName(slot: number): string {
  return slot === 0 ? SESSION_COOKIE : `${SESSION_COOKIE}_${slot}`;
}
