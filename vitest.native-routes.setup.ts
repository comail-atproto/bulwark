import { vi } from 'vitest';

// Native route fixtures describe an authorized mailbox. Comail gate tests
// use the real access checks or explicitly deny access in the unit project.
vi.mock('@/lib/groupware/access', () => ({
  groupwareAllowed: vi.fn().mockResolvedValue(true),
  groupwareMailboxAllowed: vi.fn().mockResolvedValue(true),
}));
