import { describe, it, expect } from 'vitest';
import { sanitizeDisplayName, splitMailbox, unquoteDisplayName } from '../rfc5322-mailbox';

describe('unquoteDisplayName', () => {
  it('strips a surrounding quoted-string and its escapes', () => {
    expect(unquoteDisplayName('"Doe, John"')).toBe('Doe, John');
    expect(unquoteDisplayName('"Say \\"hi\\""')).toBe('Say "hi"');
  });

  it('leaves an unquoted name alone', () => {
    expect(unquoteDisplayName('  Jane Doe ')).toBe('Jane Doe');
    expect(unquoteDisplayName('6" nails')).toBe('6" nails');
  });
});

describe('sanitizeDisplayName', () => {
  it('drops an address the name carries inline', () => {
    expect(sanitizeDisplayName('Jane Doe <jane@example.com>')).toBe('Jane Doe');
    expect(sanitizeDisplayName('"Jane Doe <jane@example.com>"')).toBe('Jane Doe');
  });

  it('drops an inline address with an unbalanced bracket', () => {
    expect(sanitizeDisplayName('janedoe<jane@example.com')).toBe('janedoe');
  });

  it('keeps a plain name and tolerates nothing', () => {
    expect(sanitizeDisplayName('Jane Doe')).toBe('Jane Doe');
    expect(sanitizeDisplayName(undefined)).toBe('');
    expect(sanitizeDisplayName(null)).toBe('');
  });
});

describe('splitMailbox', () => {
  it('splits a plain mailbox', () => {
    expect(splitMailbox('Jane Doe <jane@example.com>')).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
  });

  it('passes a bare address through without a name', () => {
    expect(splitMailbox(' jane@example.com ')).toEqual({ email: 'jane@example.com' });
  });

  it('unquotes the display name', () => {
    expect(splitMailbox('"Doe, John" <john@example.com>')).toEqual({ name: 'Doe, John', email: 'john@example.com' });
  });

  it('collapses a display name that repeats the address (#672)', () => {
    expect(splitMailbox('"Jane Doe <jane@example.com>" <jane@example.com>'))
      .toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
    expect(splitMailbox('Jane Doe <jane@example.com> <jane@example.com>'))
      .toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
  });

  it('recovers the address from a mailbox missing its closing bracket (#672)', () => {
    expect(splitMailbox('janedoe<jane.doe@example.com'))
      .toEqual({ name: 'janedoe', email: 'jane.doe@example.com' });
  });

  it('omits a name that is just the address', () => {
    expect(splitMailbox('jane@example.com <jane@example.com>')).toEqual({ email: 'jane@example.com' });
  });

  it('leaves text that is not a mailbox untouched', () => {
    expect(splitMailbox('not an address')).toEqual({ email: 'not an address' });
  });
});
