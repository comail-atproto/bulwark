import type { IJMAPClient } from '@/lib/jmap/client-interface';

/**
 * Tiny indirection used by the calendar and contact stores to look up a
 * JMAP client by local account ID without importing `auth-store` directly
 * - that would form a top-level cycle (auth-store already imports the
 * feature stores to bootstrap them after login).
 *
 * `auth-store` registers its `getClientForAccount` on module init via
 * `setClientLookup`; the feature stores call `getClientByLocalAccountId`
 * inside their mutations.
 */
type ClientLookup = (localAccountId: string) => IJMAPClient | undefined;

let lookup: ClientLookup | null = null;

export function setClientLookup(fn: ClientLookup): void {
  lookup = fn;
}

export function getClientByLocalAccountId(localAccountId: string): IJMAPClient | undefined {
  return lookup ? lookup(localAccountId) : undefined;
}
