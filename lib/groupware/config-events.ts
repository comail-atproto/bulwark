import type { ConfigData } from '@/hooks/use-config';

type ConfigListener = (data: ConfigData, slot: number) => void;
const listeners = new Set<ConfigListener>();

export function subscribeConfig(listener: ConfigListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishConfig(data: ConfigData, slot: number): void {
  for (const listener of listeners) listener(data, slot);
}
