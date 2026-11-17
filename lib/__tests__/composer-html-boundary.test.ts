import { describe, expect, it } from 'vitest';
import { INLINE_IMAGE_PLACEHOLDER, replaceInlineImagePlaceholders } from '@/lib/email-composer-utils';
import { spliceTemplateAboveSignature } from '@/lib/template-utils';

const PNG = 'data:image/png;base64,AAAA';

describe('composer HTML boundaries', () => {
  it('removes active saved markup while hydrating a formatted quote', () => {
    const saved = `<div data-quoted-html="true"><table style="color: red"><tbody><tr><td><strong>Quoted &amp; formatted</strong><img src="${INLINE_IMAGE_PLACEHOLDER}" data-cid="logo" onerror="alert(1)"></td></tr></tbody></table><script>alert(1)</script></div>`;
    const output = replaceInlineImagePlaceholders(saved, new Map([['logo', PNG]]));
    const body = new DOMParser().parseFromString(output, 'text/html').body;

    expect(body.querySelector('script, [onerror]')).toBeNull();
    expect(body.querySelector('[data-quoted-html] strong')?.textContent).toBe('Quoted & formatted');
    expect(body.querySelector('table')?.style.color).toBe('red');
    expect(body.querySelector('img[data-cid="logo"]')?.getAttribute('src')).toBe(PNG);
  });

  it('rejects an SVG attachment URL without losing the inline image identity', () => {
    const saved = `<p><em>Draft</em><img src="${INLINE_IMAGE_PLACEHOLDER}" data-cid="logo"></p>`;
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const output = replaceInlineImagePlaceholders(saved, new Map([['logo', svg]]));
    const body = new DOMParser().parseFromString(output, 'text/html').body;

    expect(body.querySelector('img[data-cid="logo"]')?.getAttribute('src')).toBeNull();
    expect(body.querySelector('em')?.textContent).toBe('Draft');
  });

  it('keeps a formatted signature while removing active markup from both inputs', () => {
    const saved = '<p>Old draft</p><p data-signature-block="separator">-- </p><div style="color: blue"><strong>Signature</strong><img src="cid:logo" data-cid="logo" onerror="alert(1)"><script>alert(1)</script></div><p data-signature-block="end"></p>';
    const template = '<table><tbody><tr><td><em>New body</em><a href="javascript:alert(1)">Link</a></td></tr></tbody></table>';
    const output = spliceTemplateAboveSignature(saved, template);
    const body = new DOMParser().parseFromString(output, 'text/html').body;

    expect(body.querySelector('script, [onerror], a[href]')).toBeNull();
    expect(body.querySelector('table em')?.textContent).toBe('New body');
    expect(body.querySelector('div')?.style.color).toBe('blue');
    expect(body.querySelector('strong')?.textContent).toBe('Signature');
    expect(body.querySelectorAll('[data-signature-block]')).toHaveLength(2);
    expect(body.querySelector('img[data-cid="logo"]')?.getAttribute('src')).toBe('cid:logo');
    expect(body.textContent).not.toContain('Old draft');
  });

  it('sanitizes a template even when the saved body has no signature', () => {
    const output = spliceTemplateAboveSignature('<p>Old draft</p>', '<p><strong>New body</strong><img src="cid:logo" onerror="alert(1)"></p>');
    const body = new DOMParser().parseFromString(output, 'text/html').body;

    expect(body.querySelector('[onerror]')).toBeNull();
    expect(body.querySelector('strong')?.textContent).toBe('New body');
    expect(body.querySelector('img')?.getAttribute('src')).toBe('cid:logo');
  });
});
