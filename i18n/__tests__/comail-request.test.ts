// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({ getRequestConfig: (factory: unknown) => factory }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'fr' }) }));

import requestConfig from '../comail-request';
import { routing } from '../routing';

describe('Comail server translations', () => {
  it.each(routing.locales)('keeps upstream configuration and Comail messages in %s', async (locale) => {
    const config = await requestConfig({ requestLocale: Promise.resolve(locale) });
    expect(config.locale).toBe(locale);
    expect(config.timeZone).toBe('Europe/Paris');
    expect(config.now).toBeInstanceOf(Date);
    expect(config.messages).toMatchObject({
      login: { comail_continue: 'Login with Atmosphere' },
      settings: { byomc: { title: 'Connect a mail client' } },
    });
  });

  it.each([undefined, 'unknown'])('keeps upstream language negotiation for %s', async (locale) => {
    const config = await requestConfig({ requestLocale: Promise.resolve(locale) });
    expect(config.locale).toBe('fr');
    expect(config.messages).toMatchObject({
      sidebar: { close: 'Fermer' },
      calendar: { notifications: { space_calendar_authorization_title: 'Autorisation du calendrier requise' } },
    });
  });
});
