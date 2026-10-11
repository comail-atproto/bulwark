import { describe, it, expect } from 'vitest';

/**
 * Tests for the signature appending logic used in the email composer
 * and quick-reply paths. These test the pure transformation that should
 * be applied when an identity has a textSignature.
 */

function appendSignature(body: string, textSignature: string | undefined): string {
  if (textSignature) {
    return body + '\n\n-- \n' + textSignature;
  }
  return body;
}

describe('signature appending', () => {
  it('should append text signature with standard separator', () => {
    const result = appendSignature('Hello world', 'Best regards,\nAlice');
    expect(result).toBe('Hello world\n\n-- \nBest regards,\nAlice');
  });

  it('should not modify body when signature is undefined', () => {
    const result = appendSignature('Hello world', undefined);
    expect(result).toBe('Hello world');
  });

  it('should not modify body when signature is empty string', () => {
    const result = appendSignature('Hello world', '');
    expect(result).toBe('Hello world');
  });

  it('should handle empty body with signature', () => {
    const result = appendSignature('', 'My Signature');
    expect(result).toBe('\n\n-- \nMy Signature');
  });

  it('should handle multiline body and signature', () => {
    const body = 'Dear Bob,\n\nHow are you?\n\nCheers';
    const sig = 'Alice Smith\nCompany Inc.\nhttp://example.com';
    const result = appendSignature(body, sig);
    expect(result).toContain('Dear Bob,');
    expect(result).toContain('-- \n');
    expect(result).toContain('Alice Smith');
    expect(result).toContain('Company Inc.');
  });

  it('should use RFC 3676 signature separator (dash dash space newline)', () => {
    const result = appendSignature('body', 'sig');
    // The separator should be "-- \n" (two dashes, a space, then newline)
    expect(result).toContain('-- \n');
  });

  it('should place signature after two blank lines from body', () => {
    const result = appendSignature('body text', 'sig');
    expect(result).toBe('body text\n\n-- \nsig');
    // Verify the structure: body + \n\n + "-- \n" + signature
    const parts = result.split('\n\n');
    expect(parts[0]).toBe('body text');
    expect(parts[1]).toBe('-- \nsig');
  });

  it('should handle body that already ends with newlines', () => {
    const result = appendSignature('body\n\n', 'sig');
    // Still adds the separator - this matches the composer behavior
    expect(result).toBe('body\n\n\n\n-- \nsig');
  });
});
