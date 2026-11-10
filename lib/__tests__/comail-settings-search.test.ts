import { describe, expect, it } from 'vitest';
import en from '@/locales/en/common.json';
import { withComailMessages } from '@/i18n/comail-messages';
import {
  settingsSubResults, tabKeywords, tabSearchEntries,
} from '@/lib/comail-settings-search';
import {
  getByPath, settingsSubResults as nativeSubResults,
  tabSearchEntries as nativeEntries,
} from '@/lib/settings-search';

const messages = withComailMessages('en', en as unknown as import('next-intl').AbstractIntlMessages);

describe('Comail settings search', () => {
  it('adds the mail-client page without changing the native index', () => {
    expect(nativeEntries).not.toHaveProperty('byomc');
    expect(tabSearchEntries.byomc).toEqual([{ label: 'settings.byomc.title' }]);
    expect(tabKeywords.byomc).toContain('imap');
    expect(settingsSubResults(messages, 'byomc', 'Comail')).toEqual([
      { label: getByPath(messages, 'settings.byomc.title'), description: getByPath(messages, 'settings.byomc.description') },
    ]);
  });

  it('keeps the native search results and visibility filter', () => {
    expect(settingsSubResults(messages, 'general', 'Comail')).toEqual(
      nativeSubResults(messages, 'general', 'Comail'),
    );
    expect(settingsSubResults(messages, 'byomc', 'Comail', () => false)).toEqual([]);
  });
});
