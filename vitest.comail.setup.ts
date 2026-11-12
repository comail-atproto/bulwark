import { afterAll, vi } from 'vitest';
import { configure } from '@testing-library/react';

vi.mock('@/app/comail-fonts', () => ({
  atkinsonHyperlegible: { variable: '--comail-font-body' },
  youngSerif: { variable: '--comail-font-display' },
}));

// Sandbox startup includes asynchronous module loading on shared workers.
configure({ asyncUtilTimeout: 5_000 });

// Settings hydration loads the template store asynchronously. Finish pending
// imports before Vitest tears down this file's jsdom environment.
afterAll(async () => { await vi.dynamicImportSettled(); });
