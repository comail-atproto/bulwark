import { describe, it, expect } from 'vitest';
import { isSameIdentity } from '@/lib/account-utils';

describe('isSameIdentity', () => {
  it('returns true when name and email are identical', () => {
    expect(isSameIdentity('example@example.com', 'example@example.com')).toBe(true);
  });

  it('returns true when name and email differ only by case', () => {
    expect(isSameIdentity('Example@Example.com', 'example@example.com')).toBe(true);
  });

  it('returns true when name and email differ only by whitespace', () => {
    expect(isSameIdentity('  example@example.com  ', 'example@example.com')).toBe(true);
  });

  it('returns false when a real display name differs from email', () => {
    expect(isSameIdentity('Example User', 'example@example.com')).toBe(false);
  });

  it('returns false when name is a different email address', () => {
    expect(isSameIdentity('alice@example.com', 'example@example.com')).toBe(false);
  });

  it('returns true when both are empty', () => {
    expect(isSameIdentity('', '')).toBe(true);
  });

  it('returns true when name is empty and email is whitespace only', () => {
    expect(isSameIdentity('  ', ' ')).toBe(true);
  });

  it('returns false when name is a label like "Alice" and email is "alice@example.com"', () => {
    expect(isSameIdentity('Alice', 'alice@example.com')).toBe(false);
  });
});
