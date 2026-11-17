import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// The kit's fields tell a screen reader about their hint, error and
// required state, and the kit's own button names follow the app language
// instead of being English (or "×") everywhere.

const kit = await import('../plugin-sandbox/ui-kit');
const { KIT_STRINGS, kitString } = await import('../plugin-sandbox/ui-kit/kit-strings');

const setLocale = (locale: string | undefined) => {
  (globalThis as unknown as { __PLUGIN_LOCALE__?: string }).__PLUGIN_LOCALE__ = locale;
};

describe('plugin UI kit accessibility', () => {
  afterEach(() => setLocale(undefined));

  it('reads a Field\'s hint with its control', () => {
    render(<kit.Field label="Title" hint="Shown in Paperless"><kit.Input /></kit.Field>);
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAccessibleDescription('Shown in Paperless');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks a Field with an error invalid and reads the error', () => {
    render(<kit.Field label="Title" error="Title is missing" required><kit.Input /></kit.Field>);
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Title is missing');
  });

  it('names the clear button of a search box in the app language', () => {
    setLocale('de');
    render(<kit.SearchInput value="x" onChange={() => {}} label="Search" />);
    expect(screen.getByRole('button', { name: 'Suche leeren' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '×' })).toBeNull();
  });

  it('falls back from a regional locale to its language, then English', () => {
    setLocale('de-AT');
    expect(kitString('clear')).toBe('Leeren');
    setLocale('xx');
    expect(kitString('remove_named', { name: 'Apple' })).toBe('Remove Apple');
  });

  it('has every kit string in every app locale', () => {
    const dir = path.resolve(__dirname, '../../locales');
    const locales = readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory() && !d.startsWith('_'));
    const keys = Object.keys(KIT_STRINGS.en).sort();
    for (const locale of locales) {
      expect(Object.keys(KIT_STRINGS[locale] ?? {}).sort(), locale).toEqual(keys);
    }
  });
});
