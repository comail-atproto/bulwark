import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppMain, SkipLink } from '../app-landmarks';
import { PaneCycleHost, cyclePane } from '../pane-cycle';

// SR-04 / SR-05: one <main> per app with an h1 naming the place, a skip link
// to it, and F6 / Shift+F6 between the panes.

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppMain', () => {
  it('is the main landmark, named by its h1', () => {
    render(<AppMain heading="Inbox – Mail"><p>list</p></AppMain>);
    const main = screen.getByRole('main', { name: 'Inbox – Mail' });
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox – Mail' })).toBeInTheDocument();
    expect(main).toHaveAttribute('data-pane', 'main');
  });

  it('is a named region, not a second main, inside the Pro shell', () => {
    render(<AppMain embedded label="Calendar"><p>grid</p></AppMain>);
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('region', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('leaves F6 to the panes inside it when asked', () => {
    render(<AppMain heading="x" pane={false}><p>list</p></AppMain>);
    expect(screen.getByRole('main')).not.toHaveAttribute('data-pane');
  });
});

describe('SkipLink', () => {
  it('moves the focus to the main content and lets it go again', () => {
    render(
      <>
        <SkipLink>Skip to content</SkipLink>
        <button>rail</button>
        <AppMain heading="Contacts"><button>first</button></AppMain>
      </>,
    );
    act(() => { fireEvent.click(screen.getByRole('link', { name: 'Skip to content' })); });
    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    // The tabindex lasts only while focused, so clicks inside don't keep the focus there.
    act(() => { screen.getByRole('button', { name: 'first' }).focus(); });
    expect(main).not.toHaveAttribute('tabindex');
  });
});

describe('F6 between panes', () => {
  function layout() {
    render(
      <>
        <PaneCycleHost />
        <nav aria-label="Folders" data-pane="folders">
          <button>Sent</button>
          <button aria-current="page">Inbox</button>
        </nav>
        <div id="message-list" tabIndex={-1} data-pane="list"><span>row</span></div>
        <section aria-label="Reading pane" data-pane="reader"><button>Reply</button></section>
      </>,
    );
  }
  const f6 = (shiftKey = false) => act(() => { fireEvent.keyDown(document.body, { key: 'F6', shiftKey }); });

  it('goes folders, list, reader and round again', () => {
    layout();
    f6();
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveFocus();
    f6();
    expect(document.getElementById('message-list')).toHaveFocus();
    f6();
    expect(screen.getByRole('region', { name: 'Reading pane' })).toHaveFocus();
    f6();
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveFocus();
  });

  it('goes back with Shift+F6', () => {
    layout();
    act(() => { document.getElementById('message-list')!.focus(); });
    f6(true);
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveFocus();
    f6(true);
    expect(screen.getByRole('region', { name: 'Reading pane' })).toHaveFocus();
  });

  it('moves on from wherever the focus is inside a pane', () => {
    layout();
    act(() => { screen.getByRole('button', { name: 'Reply' }).focus(); });
    f6();
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveFocus();
  });

  it('stays put while a dialog is open', () => {
    layout();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const inside = document.createElement('button');
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    act(() => inside.focus());
    f6();
    expect(inside).toHaveFocus();
  });

  it('skips a pane that is hidden', () => {
    render(
      <>
        <div data-pane="sidebar" hidden><button aria-current="page">x</button></div>
        <section aria-label="Content" data-pane="main"><button>y</button></section>
      </>,
    );
    expect(cyclePane(false)).toBe(true);
    expect(screen.getByRole('region', { name: 'Content' })).toHaveFocus();
  });
});
