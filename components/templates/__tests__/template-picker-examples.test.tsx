import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TemplatePicker } from '../template-picker';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { usePolicyStore } from '@/stores/policy-store';
import { useTemplateStore } from '@/stores/template-store';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import { accessibleTemplate } from '@/lib/templates/built-in-templates';
import en from '@/locales/en/common.json';

// The accessible example template (MA-06) comes with the app. The global
// next-intl mock returns keys.

beforeEach(() => {
  const subject = { email: 'alice@example.org', groups: [] };
  usePolicyStore.setState({ rawPolicy: DEFAULT_POLICY, policy: resolvePolicy(DEFAULT_POLICY, subject).policy, subject });
  useTemplateStore.setState({ templates: [], recentTemplateIds: [], deletedTemplateIds: {} });
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null });
});

describe('built-in example templates', () => {
  it('offers the accessible message under Examples, also with no templates of the user', () => {
    const onSelect = vi.fn();
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={onSelect} />);
    const examples = screen.getByRole('region', { name: 'section_examples' });
    fireEvent.click(within(examples).getByText('builtin.accessible.name'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const [template, values] = onSelect.mock.calls[0];
    expect(values).toEqual({});
    expect(template.isHTML).toBe(true);
    expect(template.body).toContain('<h1>');
    // Picking an example does not list it under recently used.
    expect(useTemplateStore.getState().recentTemplateIds).toEqual([]);
  });

  it('finds it by search', () => {
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('search_placeholder'), { target: { value: 'accessible' } });
    expect(screen.getByText('builtin.accessible.name')).toBeInTheDocument();
    expect(screen.queryByText('no_results')).toBeNull();
  });
});

describe('accessibleTemplate', () => {
  const text = (key: string) => key.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown>)[part],
    en.templates.builtin,
  ) as string;

  it('uses real headings and a list, and no colours or images', () => {
    const template = accessibleTemplate(text);
    const doc = new DOMParser().parseFromString(template.body, 'text/html');
    expect(template.name).toBe('Accessible message');
    expect(doc.querySelector('h1')?.textContent).toBe('What this message is about');
    expect(doc.querySelectorAll('h2')).toHaveLength(2);
    expect(doc.querySelectorAll('ul > li')).toHaveLength(3);
    expect(doc.querySelector('img, [style], font')).toBeNull();
  });

  it('escapes the translated text', () => {
    const template = accessibleTemplate((key) => (key.endsWith('heading') ? '<b>x</b>' : 'y'));
    expect(template.body).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
