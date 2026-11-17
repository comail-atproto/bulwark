import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminUnsavedStore } from '@/stores/admin-unsaved-store';
import { EVERYONE, useOrgScopeStore } from '@/components/admin/org/use-org-policy-draft';

// AL-12: a lock set on the User policy page carries the value users get,
// and the page presets any setting, with an Accessibility category that
// offers presets for everything but locks only for the few options that
// can't leave someone unable to use the app.

const puts: Array<Record<string, unknown>> = [];
let stored: Record<string, unknown> = {};
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return new Response('{"ok":true}');
    }
    return new Response(JSON.stringify(stored), { headers: { 'content-type': 'application/json' } });
  }),
  withBasePath: (p: string) => p,
}));

import { PolicyPage } from '../_pages/policy';

const BASE = {
  restrictions: {}, features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  pushRelays: [], pushRelayUrl: '', pushRelayUrlLocked: false, defaultSidebarApps: [],
};

/** The settings row (label plus controls) for `label` inside a section. */
function row(section: HTMLElement, label: string): HTMLElement {
  const name = within(section).getByText(label, { selector: 'span, label, p, div' });
  let el: HTMLElement | null = name;
  while (el && !el.hasAttribute('data-search-label')) el = el.parentElement;
  if (!el) throw new Error(`no row for ${label}`);
  return el;
}

const section = (id: string) => document.querySelector<HTMLElement>(`[data-settings-section="${id}"]`)!;

async function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
  await waitFor(() => expect(puts.length).toBe(1));
  return puts[0] as { restrictions: Record<string, unknown>; defaults: Record<string, unknown>; scopes?: Array<{ policy: Record<string, unknown> }> };
}

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(BASE));
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});
afterEach(() => {
  useAdminUnsavedStore.setState({ dirty: {}, pendingLeave: null, pendingScope: null });
});

describe('User policy page: locks', () => {
  it('locks single-key shortcuts to the value picked', async () => {
    render(<PolicyPage />);
    await screen.findByText('Locked settings');
    const shortcuts = row(section('restrictions'), 'Single-key shortcuts');
    fireEvent.click(within(shortcuts).getByRole('checkbox', { name: /Lock/ }));
    const value = within(shortcuts).getByRole('switch', { name: 'Value users get for Single-key shortcuts' });
    expect(value.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(value);

    const body = await save();
    expect(body.restrictions.singleKeyShortcuts).toEqual({ locked: true, value: false });
  });

  it('sets a minimum notification duration instead of a lock', async () => {
    render(<PolicyPage />);
    await screen.findByText('Locked settings');
    const toast = row(section('restrictions'), 'Notification duration');
    expect(within(toast).queryByRole('checkbox', { name: /Lock/ })).toBeNull();
    fireEvent.change(within(toast).getByRole('combobox', { name: 'Minimum for Notification duration' }), { target: { value: '20' } });

    const body = await save();
    expect(body.restrictions.toastDuration).toEqual({ min: 20 });
  });

  it('offers no lock for text size, contrast or motion', async () => {
    render(<PolicyPage />);
    await screen.findByText('Locked settings');
    const locks = section('restrictions');
    for (const label of ['Text size', 'Contrast', 'Reduce motion', 'Font', 'Line spacing']) {
      expect(within(locks).queryByText(label)).toBeNull();
    }
    expect(within(locks).getByText('Confirm before sending')).toBeTruthy();
  });

  it('offers to give an old lock without a value one', async () => {
    stored = { ...BASE, restrictions: { showPreview: { locked: true } }, defaults: { showPreview: false } };
    render(<PolicyPage />);
    await screen.findByText('Locked settings');
    const preview = row(section('restrictions'), 'Show Preview');
    expect(within(preview).getByText('No value: each user keeps the value they had.')).toBeTruthy();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lock to Off' }));

    const body = await save();
    expect(body.restrictions.showPreview).toEqual({ locked: true, value: false });
  });
});

describe('User policy page: defaults', () => {
  it('presets accessibility options, including ones that cannot be locked', async () => {
    render(<PolicyPage />);
    await screen.findByText('Defaults');
    const accessibility = screen.getByTestId('defaults-Accessibility');
    fireEvent.change(within(row(accessibility, 'Text size')).getByRole('combobox'), { target: { value: 'xx-large' } });
    fireEvent.change(within(row(accessibility, 'Contrast')).getByRole('combobox'), { target: { value: 'more' } });
    fireEvent.change(within(row(accessibility, 'Notification duration')).getByRole('combobox'), { target: { value: '20' } });
    fireEvent.click(within(row(accessibility, 'Underline links')).getByRole('switch'));

    const body = await save();
    expect(body.defaults).toEqual({ fontSize: 'xx-large', contrast: 'more', toastDuration: 20, underlineLinks: true });
  });

  it('removes a default and keeps unknown ones from policy.json', async () => {
    stored = { ...BASE, defaults: { reduceMotion: 'on', dateFormat: 'iso' } };
    render(<PolicyPage />);
    await screen.findByText('Defaults');
    const defaults = section('defaults');
    fireEvent.click(within(row(defaults, 'Reduce motion')).getByRole('button', { name: 'Remove the default' }));
    expect(within(row(defaults, 'dateFormat')).getByRole('textbox')).toBeTruthy();

    const body = await save();
    expect(body.defaults).toEqual({ dateFormat: 'iso' });
  });

  it.each([
    { kind: 'domain', match: { domains: ['example.org'] } },
    { kind: 'group', match: { groups: ['team@example.org'] } },
  ])('writes into the $kind scope picked', async ({ match }) => {
    stored = {
      ...BASE,
      defaults: { fontSize: 'large' },
      scopes: [
        { id: 'team', label: 'Team', match, policy: {} },
        { id: 'other', label: 'Other', match: { domains: ['example.net'] }, policy: { defaults: { fontSize: 'small' } } },
      ],
    };
    render(<PolicyPage />);
    await screen.findByText('Defaults');
    const defaults = section('defaults');
    fireEvent.click(within(defaults).getByRole('button', { name: 'Team' }));
    const size = row(defaults, 'Text size');
    expect(await within(size).findByText('From Everyone')).toBeTruthy();
    expect(within(defaults).getByRole('button', { name: 'Team', pressed: true })).toBeTruthy();
    expect(within(size).getByRole('combobox')).toHaveValue('large');
    fireEvent.change(within(size).getByRole('combobox'), { target: { value: 'huge' } });

    const body = await save();
    expect(body.defaults).toEqual({ fontSize: 'large' });
    expect(body.scopes?.[0].policy.defaults).toEqual({ fontSize: 'huge' });
    expect(body.scopes?.[1].policy.defaults).toEqual({ fontSize: 'small' });
  });
});
