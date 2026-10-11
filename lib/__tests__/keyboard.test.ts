import { describe, it, expect, afterEach } from 'vitest';

import { isEditableEventTarget } from '../keyboard';

// Regression tests for #654: global single-key shortcuts fired while the user
// was editing inside the QuotedHtml shadow-DOM island, because the shadow
// boundary retargets both document.activeElement and event.target to the
// plain-div host. isEditableEventTarget must rely on composedPath instead.

// Evaluate from a window-level listener DURING dispatch — composedPath() is
// only populated while the event is being dispatched, matching how the real
// shortcut handlers run.
function dispatchAndCheck(el: HTMLElement): { editable: boolean; target: EventTarget | null } {
  let result: { editable: boolean; target: EventTarget | null } | null = null;
  const listener = (e: Event) => {
    result = { editable: isEditableEventTarget(e), target: e.target };
  };
  window.addEventListener('keydown', listener);
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true })
  );
  window.removeEventListener('keydown', listener);
  if (!result) throw new Error('keydown never reached window');
  return result;
}

describe('isEditableEventTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('detects plain inputs and textareas', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(dispatchAndCheck(el).editable).toBe(true);
    }
  });

  it('detects a contentEditable element', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    expect(dispatchAndCheck(el).editable).toBe(true);
  });

  it('returns false for a non-editable element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(dispatchAndCheck(el).editable).toBe(false);
  });

  it('sees through a shadow boundary to an inner contentEditable (QuotedHtml island)', () => {
    // Mirror the structure quoted-html.ts builds: plain-div host, open shadow
    // root, inner contentEditable div.
    const host = document.createElement('div');
    host.className = 'quoted-html-island';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    inner.setAttribute('contenteditable', 'true');
    shadow.appendChild(inner);

    const { editable, target } = dispatchAndCheck(inner);
    // Sanity: the shadow boundary retargets the event — the outside listener
    // sees the host, which is exactly why a target/activeElement check fails.
    expect(target).toBe(host);
    expect(editable).toBe(true);
  });

  it('still returns false for a non-editable shadow tree', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    shadow.appendChild(inner);

    expect(dispatchAndCheck(inner).editable).toBe(false);
  });
});
