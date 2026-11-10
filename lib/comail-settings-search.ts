import {
  descriptionKeyFor, getByPath, settingsSubResults as nativeSubResults,
  tabKeywords as nativeKeywords, tabSearchEntries as nativeEntries, withAppName,
  type SettingsSearchEntry, type SettingsSearchTab as NativeTab, type SubResult,
} from '@/lib/settings-search';

export * from '@/lib/settings-search';
export type SettingsSearchTab = NativeTab | 'byomc';

// The native index has no registration hook for deployment-specific pages.
export const tabSearchEntries: Record<SettingsSearchTab, SettingsSearchEntry[]> = {
  ...nativeEntries,
  byomc: [{ label: 'settings.byomc.title' }],
};
export const tabKeywords: Record<SettingsSearchTab, string> = {
  ...nativeKeywords,
  byomc: 'imap smtp client thunderbird apple mail password',
};

export function settingsSubResults(
  messages: unknown,
  tab: SettingsSearchTab,
  appName: string,
  shown: (entry: SettingsSearchEntry) => boolean = () => true,
): SubResult[] {
  if (tab !== 'byomc') return nativeSubResults(messages, tab, appName, shown);
  const entry = tabSearchEntries.byomc[0];
  const label = getByPath(messages, entry.label);
  if (!shown(entry) || typeof label !== 'string') return [];
  const descriptionKey = descriptionKeyFor(entry.label, messages);
  const description = descriptionKey ? getByPath(messages, descriptionKey) as string : undefined;
  return [{
    label: withAppName(label, appName) as string,
    ...(description ? { description: withAppName(description, appName) as string } : {}),
  }];
}
