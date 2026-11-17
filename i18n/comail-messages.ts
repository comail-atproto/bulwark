import type { AbstractIntlMessages } from 'next-intl';
import { mergeMessages } from './merge-messages';
import comail from './comail-messages.json';

const localized: Record<string, AbstractIntlMessages> = comail.locales;

export function withComailMessages(locale: string, messages: AbstractIntlMessages): AbstractIntlMessages {
  return mergeMessages(
    mergeMessages(messages, comail.common),
    Object.hasOwn(localized, locale) ? localized[locale] : localized.en,
  ) as AbstractIntlMessages;
}
