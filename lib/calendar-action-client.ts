import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { getClientByLocalAccountId } from '@/stores/client-registry';

/** Resolve a calendar-specific action to the account that owns that calendar. */
export function resolveCalendarActionClient<T extends IJMAPClient>(
  calendar: { source?: string; localAccountId?: string },
  activeClient: T,
): T | undefined {
  if (!calendar.localAccountId) return activeClient;
  const ownerClient = getClientByLocalAccountId(calendar.localAccountId) as T | undefined;
  if (ownerClient) return ownerClient;
  return calendar.source === 'atproto-space' ? undefined : activeClient;
}
