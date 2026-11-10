import { act, render, screen, waitFor } from '@testing-library/react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/locales/en/common.json';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsStore } from '@/stores/settings-store';
import { IntlProvider } from '../comail-intl-provider';

vi.unmock('next-intl');

function Messages() {
  const t = useTranslations();
  const locale = useLocale();
  const timeZone = useTimeZone();
  return (
    <p>
      {locale} / {timeZone} / {t('login.comail_continue')} / {t('sidebar.close')} /
      {t('login.waitlist.identity', { identity: 'alice.example' })} /
      {t('calendar.notifications.space_calendar_authorization_title')}
    </p>
  );
}

describe('Comail client translations', () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: 'en' });
    useSettingsStore.setState({ timeZone: 'UTC' });
  });

  it('adds Comail text to stock English messages and formats placeholders', () => {
    render(<IntlProvider locale="en" messages={en}><Messages /></IntlProvider>);
    expect(screen.getByText(/Login with Atmosphere/)).toHaveTextContent('en / UTC');
    expect(screen.getByText(/Signed in as alice.example/)).toHaveTextContent('Calendar authorization needed');
  });

  it('keeps Comail text while upstream changes the language and text direction', async () => {
    render(<IntlProvider locale="en" messages={en}><Messages /></IntlProvider>);
    act(() => useLocaleStore.getState().setLocale('fr'));
    await waitFor(() => expect(screen.getByText(/Login with Atmosphere/)).toHaveTextContent('fr / UTC'));
    expect(screen.getByText(/Login with Atmosphere/)).toHaveTextContent('Fermer');
    expect(screen.getByText(/Login with Atmosphere/)).toHaveTextContent('Autorisation du calendrier requise');

    act(() => useLocaleStore.getState().setLocale('he'));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(screen.getByText(/Login with Atmosphere/)).toHaveTextContent('he / UTC');
    act(() => useLocaleStore.getState().setLocale('en'));
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(screen.getByText(/Login with Atmosphere/)).toHaveTextContent('en / UTC');
  });
});
