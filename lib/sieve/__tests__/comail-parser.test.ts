import { describe, expect, it } from 'vitest';
import { parseScript } from '../parser';

describe('attachment header safety', () => {
  it('rejects a malformed attachment header list promptly', () => {
    const headers = `[${'"" '.repeat(26)}!]`;
    const script = `if header :mime :anychild :matches ${headers} "*.pdf*" { discard; }`;
    const start = performance.now();
    const result = parseScript(script);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.rules[0].origin).toBe('opaque');
    expect(result.rules[0].rawBlock).toContain(headers);
  });

  it('recognises the two attachment headers and preserves invalid lists', () => {
    for (const headers of ['["Content-Disposition", "Content-Type"]', '["Content-Type" "Content-Disposition",]']) {
      const result = parseScript(`if header :mime :anychild :matches ${headers} "*.pdf*" { discard; }`);
      expect(result.rules[0].conditions[0]).toMatchObject({ field: 'attachment', comparator: 'has_type', value: 'pdf' });
    }
    const result = parseScript('if header :mime :anychild :matches ["Content-Disposition",, "Content-Type"] "*.pdf*" { discard; }');
    expect(result.rules[0].origin).toBe('opaque');
  });
});
