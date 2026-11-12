'use client';

import { useMemo, type ComponentProps } from 'react';
import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from 'next-intl';
import { IntlProvider as UpstreamIntlProvider } from './intl-provider';
import { withComailMessages } from '@/i18n/comail-messages';

function ComailMessages({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const upstream = useMessages();
  const timeZone = useTimeZone();
  const messages = useMemo(() => withComailMessages(locale, upstream), [locale, upstream]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}

export function IntlProvider({ children, ...props }: ComponentProps<typeof UpstreamIntlProvider>) {
  return (
    <UpstreamIntlProvider {...props}>
      <ComailMessages>{children}</ComailMessages>
    </UpstreamIntlProvider>
  );
}
