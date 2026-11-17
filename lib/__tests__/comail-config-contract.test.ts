import { describe, expect, it } from 'vitest';
import { isConfigData } from '@/lib/config-validation';
import { createConfig } from './fixtures/config';

describe('private groupware configuration flags', () => {
  it.each(['privateCalendarEnabled', 'privateContactsEnabled', 'privateFilesEnabled'] as const)(
    'accepts only an optional boolean for %s', key => {
      for (const value of [null, 'true', 1]) expect(isConfigData({ ...createConfig(), [key]: value })).toBe(false);
      for (const value of [undefined, true, false]) expect(isConfigData({ ...createConfig(), [key]: value })).toBe(true);
    },
  );
});
