import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { getClientByLocalAccountId } from '@/stores/client-registry';

// Aggregated rows carry their owning account. The registry avoids an auth-store import cycle.
export function resolveAccountClient<T extends IJMAPClient>(active: T, localAccountId?: string): T {
  if (!localAccountId) return active;
  const owner = getClientByLocalAccountId(localAccountId) as T | undefined;
  if (!owner) throw new Error('Reconnect the owning account before making changes.');
  return owner;
}
