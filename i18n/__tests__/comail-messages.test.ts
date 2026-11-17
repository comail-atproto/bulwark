import { describe, expect, it } from 'vitest';
import { withComailMessages } from '../comail-messages';

describe('Comail messages over an upstream catalog', () => {
  it.each(['en', 'fr', 'ar'])('keeps contact export failures available in %s', (locale) => {
    expect(withComailMessages(locale, {})).toMatchObject({
      contacts: { export: { failed: 'Contacts could not be exported without losing unsupported fields' } },
    });
  });

  it('adds Comail messages without changing the upstream catalog', () => {
    const upstream = { login: { title: 'Sign in' }, future: { label: 'New upstream feature' } };
    const messages = withComailMessages('en', upstream);

    expect(messages.login).toMatchObject({ title: 'Sign in', comail_continue: 'Login with Atmosphere' });
    expect(messages.future).toEqual(upstream.future);
    expect(upstream).toEqual({ login: { title: 'Sign in' }, future: { label: 'New upstream feature' } });
  });

  it('keeps translated authorization messages and ICU placeholders', () => {
    const messages = withComailMessages('fr', {});
    expect(messages.calendar).toMatchObject({
      notifications: {
        space_calendar_authorization_title: 'Autorisation du calendrier requise',
      },
    });
    expect(messages.login).toMatchObject({
      waitlist: { identity: 'Signed in as {identity}.' },
    });
  });

  it.each(['new-locale', 'constructor', '__proto__', 'toString'])('uses the English Comail fallback for %s', (locale) => {
    expect(withComailMessages(locale, { future: { label: 'Translated feature' } })).toMatchObject({
      future: { label: 'Translated feature' },
      login: { comail_continue: 'Login with Atmosphere' },
      settings: { byomc: { title: 'Connect a mail client' } },
    });
  });
});
