import { vi } from 'vitest';
import { createConfig } from './lib/__tests__/fixtures/config';

// Native UI fixtures have no Comail account session. Keep their configuration
// explicit without changing the upstream fixture or bypassing runtime access.
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ ...createConfig({ contactsEnabled: true }), isLoading: false, error: null }),
}));
