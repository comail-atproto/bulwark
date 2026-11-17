import { afterEach, beforeEach, vi } from 'vitest';
import { createConfig } from './lib/__tests__/fixtures/config';

// Native UI fixtures describe available features without a Comail session.
const enabledFeatures = vi.hoisted(() => ({ calendarEnabled: true, contactsEnabled: true, filesEnabled: true, appsEnabled: true }));
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ ...createConfig(enabledFeatures), isLoading: false, error: null }),
}));

// Local native mocks can replace the shared mock. Fill only their missing
// deployment fields while retaining their state changes and explicit values.
let restoreFixture: (() => void) | undefined;
beforeEach(async () => {
  const config = await import('@/hooks/use-config');
  const readFixture = config.useConfig;
  const spy = vi.spyOn(config, 'useConfig').mockImplementation(() => {
    const fixture = readFixture();
    return { ...createConfig(enabledFeatures), ...fixture, isLoading: fixture.isLoading ?? false, error: fixture.error ?? null };
  });
  restoreFixture = () => spy.mockRestore();
});
afterEach(() => restoreFixture?.());
