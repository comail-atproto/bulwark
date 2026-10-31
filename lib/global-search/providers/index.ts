import { calendarProvider } from '@/lib/global-search/providers/calendar';
import { contactsProvider } from '@/lib/global-search/providers/contacts';
import { filesProvider } from '@/lib/global-search/providers/files';
import { mailProvider } from '@/lib/global-search/providers/mail';
import type { SearchProvider } from '@/lib/global-search/types';

export const GLOBAL_SEARCH_PROVIDERS: readonly SearchProvider[] = [
  mailProvider,
  contactsProvider,
  calendarProvider,
  filesProvider,
];
