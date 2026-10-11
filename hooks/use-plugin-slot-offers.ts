'use client';

// Reactive accessor for sandboxed plugin slot offers. Components that gate
// layout on the *presence* of a plugin-supplied slot (e.g. a detail
// sidebar) read from here instead of the legacy `usePluginStore.slots` map.

import { useSyncExternalStore } from 'react';
import type { SlotName } from '@/lib/plugin-types';
import { offersForSlot, subscribe } from '@/lib/plugin-sandbox/registry';

export function usePluginSlotOffers(slotName: SlotName) {
  const getSnapshot = () => offersForSlot(slotName);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
