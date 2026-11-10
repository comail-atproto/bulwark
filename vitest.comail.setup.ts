import { afterAll, vi } from 'vitest';

// Settings hydration loads the template store asynchronously. Finish pending
// imports before Vitest tears down this file's jsdom environment.
afterAll(async () => { await vi.dynamicImportSettled(); });
