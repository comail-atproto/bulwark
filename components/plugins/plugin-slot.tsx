'use client';

import React, { useSyncExternalStore } from 'react';
import type { SlotName } from '@/lib/plugin-types';
import { offersForSlot, subscribe } from '@/lib/plugin-sandbox/registry';
import { PluginIframeSlot } from './plugin-iframe-slot';

interface PluginSlotProps {
  name: SlotName;
  className?: string;
  extraProps?: Record<string, unknown>;
}

export function PluginSlot({ name, className, extraProps }: PluginSlotProps) {
  const getSnapshot = () => offersForSlot(name);
  const offers = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (offers.length === 0) return null;

  return (
    <div className={className} data-plugin-slot={name}>
      {offers.map((offer) => (
        <PluginIframeSlot
          key={offer.pluginId}
          pluginId={offer.pluginId}
          slot={name}
          extraProps={extraProps}
        />
      ))}
    </div>
  );
}
