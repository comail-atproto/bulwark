import { afterEach, describe, expect, it } from 'vitest';
import { flatFieldsSkin } from '../theme-flat-fields';

// Under Flat fields an unread sender (600) and a read one (500) looked the
// same in Hanken Grotesk, so nobody could tell which mail was unread. The
// skin pushes unread to 700 and read senders to 400.

function mountRow(unread: boolean, nameClass: string) {
  document.body.setAttribute('data-theme-skin', 'builtin-flat-fields');
  const style = document.createElement('style');
  // The app's own weights, which the skin has to beat.
  style.textContent = `
    .font-medium { font-weight: 500; }
    .font-semibold { font-weight: 600; }
    .font-bold { font-weight: 700; }
  ` + flatFieldsSkin;
  document.head.appendChild(style);
  document.body.innerHTML = `
    <div data-tour="email-list">
      <div data-unread="${unread}">
        <span id="name" class="${nameClass}">Ada</span>
      </div>
    </div>`;
  return getComputedStyle(document.getElementById('name')!).fontWeight;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('data-theme-skin');
});

describe('Flat fields unread weight', () => {
  it('sets unread senders and subjects in 700', () => {
    expect(mountRow(true, 'truncate text-sm font-semibold text-foreground')).toBe('700');
    expect(mountRow(true, 'truncate text-sm font-bold text-foreground')).toBe('700');
  });

  it('sets read senders in 400', () => {
    expect(mountRow(false, 'w-32 shrink-0 truncate text-sm font-medium text-foreground/80')).toBe('400');
    expect(mountRow(false, 'truncate text-sm font-medium text-muted-foreground')).toBe('400');
  });

  it('leaves other medium text in read rows alone', () => {
    expect(mountRow(false, 'inline-flex text-xs font-medium text-sky-700')).toBe('500');
  });
});
