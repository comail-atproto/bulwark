import { computeAccessibleName } from 'dom-accessibility-api';

/**
 * The form fields in `root` that have no accessible name of their own: no
 * <label>, aria-label or aria-labelledby. A placeholder doesn't count (it
 * vanishes as soon as someone types, and WCAG 3.3.2 wants a label), so it
 * is taken away while the name is computed.
 *
 * Returns one line per unnamed field (tag, type, placeholder) so a failing
 * test says which field it was. Hidden fields and file inputs that sit
 * behind a button are skipped.
 */
export function unnamedFields(root: ParentNode = document.body): string[] {
  const fields = Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea'));
  const out: string[] = [];
  for (const el of fields) {
    if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'file')) continue;
    if (el.closest('[aria-hidden="true"], [hidden]')) continue;
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) continue;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder !== null) el.removeAttribute('placeholder');
    const name = computeAccessibleName(el).trim();
    if (placeholder !== null) el.setAttribute('placeholder', placeholder);
    if (!name) {
      const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : '';
      out.push(`<${el.tagName.toLowerCase()}${type}${placeholder ? ` placeholder="${placeholder}"` : ''}>`);
    }
  }
  return out;
}
