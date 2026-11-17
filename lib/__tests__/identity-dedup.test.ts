import { describe, it, expect } from 'vitest';
import { accountRowText } from '@/lib/account-utils';

describe('account identity display', () => {
  it.each([
    ['identical name and address', 'example@example.com', 'example@example.com', null],
    ['case-insensitive duplicate', 'Example@Example.com', 'example@example.com', null],
    ['whitespace around duplicate', '  example@example.com  ', 'example@example.com', null],
    ['real display name', 'Example User', 'example@example.com', 'example@example.com'],
    ['different email as name', 'alice@example.com', 'example@example.com', 'example@example.com'],
    ['empty name and address', '', '', null],
    ['whitespace-only name and address', '  ', ' ', null],
    ['label distinct from address', 'Alice', 'alice@example.com', 'alice@example.com'],
  ] as const)('%s', (_case, name, email, subtitle) => {
    const account = { id: 'account', displayName: name, label: name, email, username: email };
    expect(accountRowText(account, [account])).toEqual({
      title: subtitle === null ? email : name,
      subtitle,
    });
  });
});
