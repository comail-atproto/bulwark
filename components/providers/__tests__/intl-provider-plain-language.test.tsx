import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import { IntlProvider } from '../intl-provider';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsStore } from '@/stores/settings-store';
import enCommon from '@/locales/en/common.json';
import deCommon from '@/locales/de/common.json';
import frCommon from '@/locales/fr/common.json';
import enPlain from '@/locales/en/plain.json';
import dePlain from '@/locales/de/plain.json';

// Plain-language mode lays locales/<en|de>/plain.json over the catalog when the
// setting is on. Every useTranslations call has to pick it up from the one
// provider, live, and only for English and German.

vi.unmock('next-intl');

function Strings() {
  const t = useTranslations('login');
  return (
    <>
      <p data-testid="plain">{t('error.invalid_credentials')}</p>
      <p data-testid="normal">{t('sign_in')}</p>
    </>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

// Lets lazily imported catalogs land.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('plain-language mode', () => {
  beforeEach(() => {
    // The fallback assertions need a key that has no plain version.
    expect((enPlain as { login: Record<string, unknown> }).login.sign_in).toBeUndefined();
    expect((dePlain as { login: Record<string, unknown> }).login.sign_in).toBeUndefined();
  });

  afterEach(() => {
    useLocaleStore.setState({ locale: '' });
    useSettingsStore.setState({ plainLanguage: false });
  });

  it('keeps the normal strings while the setting is off', async () => {
    render(<IntlProvider locale="en" messages={enCommon}><Strings /></IntlProvider>);
    await settle();
    expect(text('plain')).toBe(enCommon.login.error.invalid_credentials);
  });

  it('uses the plain English string when the setting is on', async () => {
    useSettingsStore.setState({ plainLanguage: true });
    render(<IntlProvider locale="en" messages={enCommon}><Strings /></IntlProvider>);
    expect(await screen.findByText(enPlain.login.error.invalid_credentials)).toBeTruthy();
    expect(enPlain.login.error.invalid_credentials).not.toBe(enCommon.login.error.invalid_credentials);
    // A key without a plain version keeps the common.json string.
    expect(text('normal')).toBe(enCommon.login.sign_in);
  });

  it('uses the plain German string for a German UI', async () => {
    useSettingsStore.setState({ plainLanguage: true });
    render(<IntlProvider locale="de" messages={deCommon}><Strings /></IntlProvider>);
    expect(await screen.findByText(dePlain.login.error.invalid_credentials)).toBeTruthy();
    expect(text('normal')).toBe(deCommon.login.sign_in);
  });

  it('works without server messages, as in the Lite export', async () => {
    useSettingsStore.setState({ plainLanguage: true });
    render(<IntlProvider locale="de"><Strings /></IntlProvider>);
    expect(await screen.findByText(dePlain.login.error.invalid_credentials)).toBeTruthy();
  });

  it('leaves other locales on their normal strings', async () => {
    useSettingsStore.setState({ plainLanguage: true });
    render(<IntlProvider locale="fr" messages={frCommon}><Strings /></IntlProvider>);
    await settle();
    expect(text('plain')).toBe(frCommon.login.error.invalid_credentials);
  });

  it('switches live when the setting changes', async () => {
    render(<IntlProvider locale="en" messages={enCommon}><Strings /></IntlProvider>);
    await settle();
    expect(text('plain')).toBe(enCommon.login.error.invalid_credentials);

    act(() => useSettingsStore.setState({ plainLanguage: true }));
    expect(await screen.findByText(enPlain.login.error.invalid_credentials)).toBeTruthy();

    act(() => useSettingsStore.setState({ plainLanguage: false }));
    expect(text('plain')).toBe(enCommon.login.error.invalid_credentials);
  });

  it('follows a language change while the setting stays on', async () => {
    useSettingsStore.setState({ plainLanguage: true });
    render(<IntlProvider locale="en" messages={enCommon}><Strings /></IntlProvider>);
    expect(await screen.findByText(enPlain.login.error.invalid_credentials)).toBeTruthy();

    act(() => useLocaleStore.setState({ locale: 'de' }));
    expect(await screen.findByText(dePlain.login.error.invalid_credentials)).toBeTruthy();

    act(() => useLocaleStore.setState({ locale: 'fr' }));
    expect(await screen.findByText(frCommon.login.error.invalid_credentials)).toBeTruthy();
  });
});
