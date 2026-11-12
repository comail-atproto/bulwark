import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { GLOSSARY_IDS, Term } from '../term';
import en from '@/locales/en/common.json';

// Jargon explanations (CO-14) must not depend on hovering: the info button is
// in the tab order, opens with the keyboard or a tap, and screen readers get
// the explanation as its description without opening it.

vi.unmock('next-intl');

const imap = en.glossary.terms.imap;

function renderTerm(onRowClick = () => {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <button type="button">Before</button>
      <p onClick={onRowClick}>
        Use <Term id="imap">IMAP</Term> to read mail in other apps.
      </p>
    </NextIntlClientProvider>,
  );
}

const infoButton = () => screen.getByRole('button', { name: 'What does “IMAP” mean?' });

describe('Term', () => {
  it('keeps the term in the sentence and adds a named info button', () => {
    const { container } = renderTerm();
    expect(container.querySelector('p')?.textContent).toContain('Use IMAP');
    expect(infoButton()).toHaveAttribute('type', 'button');
  });

  it('is reachable with the keyboard', () => {
    renderTerm();
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    // The info button is a real, focusable button in document order.
    expect(infoButton().tabIndex).toBe(0);
    expect(before.compareDocumentPosition(infoButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    infoButton().focus();
    expect(infoButton()).toHaveFocus();
  });

  it('gives screen readers the explanation as the description while closed', () => {
    renderTerm();
    expect(infoButton()).toHaveAttribute('aria-expanded', 'false');
    expect(infoButton()).toHaveAccessibleDescription(imap.text);
    expect(screen.queryByText(imap.text)).not.toBeVisible();
  });

  it('opens on activation and closes with Escape, returning focus', () => {
    const onRowClick = vi.fn();
    renderTerm(onRowClick);
    const button = infoButton();
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(imap.text)).toBeVisible();
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toHaveTextContent(imap.text);
    // The surrounding row doesn't react to the tap.
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByText(imap.text), { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(imap.text)).not.toBeVisible();
    expect(button).toHaveFocus();
  });

  it('closes on a tap outside', () => {
    renderTerm();
    fireEvent.click(infoButton());
    expect(screen.getByText(imap.text)).toBeVisible();
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByText(imap.text)).not.toBeVisible();
  });

  it('knows exactly the terms the glossary explains', () => {
    expect([...GLOSSARY_IDS].sort()).toEqual(Object.keys(en.glossary.terms).sort());
  });
});
