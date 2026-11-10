import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { unnamedFields } from '@/lib/__tests__/helpers/form-labels';
import { ContactForm } from '@/components/contacts/contact-form';
import type { ContactCard } from '@/lib/jmap/types';
import { TemplateForm } from '@/components/templates/template-form';
import { MvSearchForm } from '@/components/search/mv-search-form';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import { JmapServersSection } from '@/app/(main)/admin/_pages/_jmap-servers-section';
import { ContactGroupForm } from '@/components/contacts/contact-group-form';
import { PromptDialog } from '@/components/ui/prompt-dialog';

// Every field of the big forms has a name a screen reader reads out (WCAG
// 1.3.1, 3.3.2, 4.1.2): a <label> tied to it or an aria-label, never just
// a placeholder. The audit found 143 fields without one; these forms were
// the worst. A new field without a label fails here.

const fullContact: ContactCard = {
  id: '1',
  addressBookIds: {},
  name: { components: [{ kind: 'given', value: 'Alice' }, { kind: 'surname', value: 'Smith' }], isOrdered: true },
  emails: { e0: { address: 'alice@example.com' } },
  phones: { p0: { number: '+33612345678' } },
  organizations: { o0: { name: 'Acme Corp' } },
  addresses: { a0: { components: [{ kind: 'name', value: 'Main St 1' }] } },
  links: { l0: { uri: 'https://example.com' } },
  onlineServices: { s0: { uri: 'xmpp:alice@example.com', service: 'XMPP' } },
  anniversaries: { b0: { kind: 'birth', date: { '@type': 'PartialDate', year: 1990, month: 1, day: 2 } } },
  personalInfo: { p0: { kind: 'hobby', value: 'Chess' } },
  keywords: { friends: true },
  notes: { n0: { note: 'VIP' } },
  speakToAs: { grammaticalGender: 'feminine' },
  calendars: { c0: { kind: 'calendar', uri: 'https://example.com/cal' } },
} as unknown as ContactCard;

describe('form fields have labels', () => {
  it('contact form, new and with every section filled', () => {
    const { unmount } = render(<ContactForm onSave={vi.fn()} onCancel={vi.fn()} addressBooks={[{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] as never} />);
    expect(unnamedFields()).toEqual([]);
    unmount();
    render(<ContactForm contact={fullContact} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(document.querySelectorAll('input, select, textarea').length).toBeGreaterThan(20);
    expect(unnamedFields()).toEqual([]);
  });

  it('template form', () => {
    render(<TemplateForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(unnamedFields()).toEqual([]);
  });

  it('advanced search form', () => {
    render(<MvSearchForm filters={DEFAULT_SEARCH_FILTERS} onChange={vi.fn()} onSearch={vi.fn()} onClear={vi.fn()} />);
    expect(document.querySelectorAll('input').length).toBeGreaterThan(5);
    expect(unnamedFields()).toEqual([]);
  });

  it('admin server list, with two servers', () => {
    render(
      <JmapServersSection
        value={[{ id: 'a', label: 'A', url: 'https://a.example' }, { id: 'b', label: 'B', url: 'https://b.example' }] as never}
        onChange={vi.fn()}
        onRevert={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('input').length).toBeGreaterThanOrEqual(8);
    expect(unnamedFields()).toEqual([]);
  });

  it('contact group form', () => {
    render(<ContactGroupForm individuals={[]} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(unnamedFields()).toEqual([]);
  });

  it('the shared one-field prompt', () => {
    render(<PromptDialog isOpen onClose={vi.fn()} onSubmit={vi.fn()} title="Rename" placeholder="New name" />);
    expect(unnamedFields()).toEqual([]);
  });
});
