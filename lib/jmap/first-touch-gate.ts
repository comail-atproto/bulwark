/**
 * Serialises the FIRST request that touches a lazily-initialised server
 * collection, per account.
 *
 * Stalwart creates an account's default calendar (and default address book) on
 * the first access to an account that has none. On a single node that creation
 * is guarded by the node's in-memory resource cache, but in clustered / multi-
 * node deployments each node builds its own cache, so concurrent first-touch
 * requests that land on different nodes each see "no calendars" and each create
 * a default - leaving the user with two identical "Personal" calendars, one of
 * which is flagged `isDefault` and can't be removed from the UI (#907).
 *
 * Bulwark's login fans out `Calendar/get`, `CalendarEvent/query` (and
 * `AddressBook/get`, `ContactCard/query`) within a few milliseconds of each
 * other, which makes that race trivially winnable. This gate holds every later
 * request on a (collection, account) pair until the first one has settled -
 * success or failure - after which requests flow with no further coordination.
 * Method calls outside the gated collections are never delayed.
 */

type MethodCall = [string, Record<string, unknown>, string];

export type GatedCollection = 'calendar' | 'contacts';

const COLLECTION_PREFIXES: ReadonlyArray<readonly [GatedCollection, string]> = [
  ['calendar', 'Calendar/'],
  ['calendar', 'CalendarEvent/'],
  ['calendar', 'CalendarEventNotification/'],
  ['contacts', 'AddressBook/'],
  ['contacts', 'ContactCard/'],
];

function collectionOf(method: string): GatedCollection | null {
  for (const [collection, prefix] of COLLECTION_PREFIXES) {
    if (method.startsWith(prefix)) return collection;
  }
  return null;
}

/**
 * The `collection:accountId` keys a request touches. Calls without a string
 * accountId are skipped - they'd be rejected by the server anyway.
 */
export function gateKeysFor(methodCalls: ReadonlyArray<MethodCall>): string[] {
  const keys = new Set<string>();
  for (const call of methodCalls) {
    const collection = collectionOf(call[0]);
    const accountId = call[1]?.accountId;
    if (collection && typeof accountId === 'string' && accountId) {
      keys.add(`${collection}:${accountId}`);
    }
  }
  return Array.from(keys);
}

export class FirstTouchGate {
  private settled = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();

  /**
   * Run `send` for `methodCalls`, delaying it while another request is the
   * first to touch one of the collections it uses. Resolves/rejects with
   * whatever `send` does.
   */
  async run<T>(methodCalls: ReadonlyArray<MethodCall>, send: () => Promise<T>): Promise<T> {
    const pending = gateKeysFor(methodCalls).filter((key) => !this.settled.has(key));
    if (pending.length === 0) return send();

    const waits = pending
      .map((key) => this.inFlight.get(key))
      .filter((p): p is Promise<void> => p !== undefined);
    if (waits.length > 0) {
      await Promise.all(waits);
      // Those keys are settled now; anything still pending belongs to another
      // collection/account this request happens to be first on.
      return this.run(methodCalls, send);
    }

    // First touch for every pending key: run it and let the others queue.
    const result = send();
    const done = result.then(
      () => undefined,
      () => undefined,
    );
    for (const key of pending) this.inFlight.set(key, done);
    try {
      return await result;
    } finally {
      for (const key of pending) {
        this.settled.add(key);
        this.inFlight.delete(key);
      }
    }
  }

  /** Forget everything - e.g. after reconnecting as a different account. */
  reset(): void {
    this.settled.clear();
    this.inFlight.clear();
  }
}
