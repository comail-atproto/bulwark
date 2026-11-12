import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MvComposeWindow } from '../mv-compose-window';
import { useMvComposeWindow } from '../mv-compose-context';

// Opened up over a backdrop, the compose window is a modal dialog named by
// its title bar, and Tab stays inside it. Docked, it is part of the page.

function FakeComposer() {
  const win = useMvComposeWindow()!;
  return (
    <>
      <div data-mv-compose-titlebar="">
        <h3>Re: Budget</h3>
        <button type="button" onClick={() => win.setState(win.state === 'maximized' ? 'normal' : 'maximized')}>toggle</button>
      </div>
      <input aria-label="Subject" />
    </>
  );
}

describe('MvComposeWindow', () => {
  it('is a labelled modal only while maximized and keeps Tab inside', () => {
    const { container } = render(<MvComposeWindow><FakeComposer /></MvComposeWindow>);
    expect(screen.queryByRole('dialog')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'toggle' });
    toggle.focus();
    fireEvent.click(toggle);
    const dialog = screen.getByRole('dialog', { name: 'Re: Budget' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(toggle).toHaveFocus();

    const subject = screen.getByRole('textbox', { name: 'Subject' });
    subject.focus();
    fireEvent.keyDown(subject, { key: 'Tab' });
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[data-mv-compose-window]')).not.toHaveAttribute('aria-modal');
  });
});
