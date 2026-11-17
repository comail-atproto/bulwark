/**
 * Templates that come with the app, shown under "Examples" in the template
 * picker. They are not stored anywhere: built from the UI language each time
 * the picker opens, and read-only.
 */

import type { EmailTemplate } from '@/lib/template-types';

export const BUILT_IN_TEMPLATE_PREFIX = 'builtin:';
export const ACCESSIBLE_TEMPLATE_ID = `${BUILT_IN_TEMPLATE_PREFIX}accessible`;

/** Looks up `templates.builtin.<key>` in the UI language. */
export type BuiltInTemplateText = (key: string) => string;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A message laid out the accessible way (EN 301 549 5.10.5): real headings
 * and a real list, text in the reader's default colours, no images of text.
 * Its text explains the layout, so it reads as an example to adapt.
 */
export function accessibleTemplate(text: BuiltInTemplateText): EmailTemplate {
  const s = (key: string) => escapeHtml(text(`accessible.${key}`));
  const body = [
    `<h1>${s('heading')}</h1>`,
    `<p>${s('intro')}</p>`,
    `<h2>${s('details_heading')}</h2>`,
    `<ul><li><p>${s('tip_structure')}</p></li><li><p>${s('tip_links')}</p></li><li><p>${s('tip_images')}</p></li></ul>`,
    `<h2>${s('next_heading')}</h2>`,
    `<p>${s('next')}</p>`,
  ].join('');
  return {
    id: ACCESSIBLE_TEMPLATE_ID,
    name: text('accessible.name'),
    subject: '',
    body,
    isHTML: true,
    category: '',
    isFavorite: false,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
  };
}

export function builtInTemplates(text: BuiltInTemplateText): EmailTemplate[] {
  return [accessibleTemplate(text)];
}
