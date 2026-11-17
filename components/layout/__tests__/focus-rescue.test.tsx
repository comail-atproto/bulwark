import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FocusRescueHost } from '../focus-rescue';

// SR-22: after Send, Delete, Undo, closing the composer, changing app and
// saving an event, the focus dropped to <body>.

function html(markup: string) {
  const root = document.createElement('div');
  root.innerHTML = markup;
  document.body.appendChild(root);
  return root;
}
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const focus = (selector: string) => act(() => { $(selector).focus(); });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focus rescue', () => {
  it('moves to the message list when the Delete button goes with its message', async () => {
    render(<FocusRescueHost />);
    html(`
      <main>
        <div id="message-list" tabindex="-1" data-pane="list" data-focus-fallback></div>
        <section data-pane="reader" id="reader"><button id="delete">Delete</button></section>
      </main>`);
    focus('#delete');
    act(() => { $('#delete').remove(); });
    await waitFor(() => expect($('#message-list')).toHaveFocus());
  });

  it('goes back to the Compose button when the composer closes', async () => {
    render(<FocusRescueHost />);
    html(`
      <main>
        <div id="message-list" tabindex="-1" data-focus-fallback></div>
        <button id="compose">Compose</button>
        <div data-tour="composer" id="composer"><input id="subject" aria-label="Subject" /><button id="send">Send</button></div>
      </main>`);
    focus('#compose');
    focus('#subject');
    focus('#send');
    act(() => { $('#composer').remove(); });
    await waitFor(() => expect($('#compose')).toHaveFocus());
  });

  it('finds the Reply button again when the reader was redrawn meanwhile', async () => {
    render(<FocusRescueHost />);
    html(`
      <main>
        <section data-pane="reader" id="reader"><button id="reply-old">Reply</button></section>
      </main>`);
    focus('#reply-old');
    // The inline composer takes the reader's place...
    act(() => {
      $('#reader').innerHTML = '<div data-tour="composer" id="composer"><button id="send">Send</button></div>';
    });
    focus('#send');
    // ...and the message comes back with a new Reply button.
    act(() => {
      $('#reader').innerHTML = '<button id="reply-new">Reply</button>';
    });
    await waitFor(() => expect($('#reply-new')).toHaveFocus());
  });

  it("lands on the new app's main after a rail link", async () => {
    render(<FocusRescueHost />);
    const app = html(`<nav><a href="/calendar" id="calendar-link">Calendar</a></nav><main id="mail-main"></main>`);
    focus('#calendar-link');
    act(() => { app.innerHTML = '<nav><a href="/">Mail</a></nav><main id="calendar-main"><div data-focus-fallback tabindex="-1"></div></main>'; });
    await waitFor(() => expect($('#calendar-main')).toHaveFocus());
  });

  it('goes to the calendar grid when the event editor closes and its opener is gone', async () => {
    render(<FocusRescueHost />);
    html(`
      <main>
        <div id="grid" data-focus-fallback><button id="event">Lunch, 12:00</button></div>
        <div role="dialog" id="editor"><button id="save">Save</button></div>
      </main>`);
    focus('#event');
    focus('#save');
    act(() => {
      $('#editor').remove();
      $('#event').remove();
    });
    await waitFor(() => expect($('#grid')).toHaveFocus());
  });

  it('leaves the focus alone when the user clicked somewhere that takes none', async () => {
    render(<FocusRescueHost />);
    html(`<main><div id="message-list" tabindex="-1" data-focus-fallback></div><button id="star">Star</button></main>`);
    focus('#star');
    act(() => { $('#star').blur(); });
    act(() => { document.body.appendChild(document.createElement('span')); });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(document.body);
  });
});
