import { expect, it } from 'vitest';
import { createDemoEmails } from '../fixtures/emails';
import { createDemoIdentities } from '../fixtures/identities';

it('keeps the Comail welcome message addressed to the active demo identity', () => {
  const welcome = createDemoEmails().find((email) => email.subject === 'Welcome to Comail!');
  expect(welcome).toBeDefined();
  expect(welcome?.from).toEqual([{ name: 'Comail Team', email: 'welcome@comail.email' }]);
  expect(welcome?.to?.[0].email).toBe(createDemoIdentities()[0].email);
});

it('identifies the Comail demo in the primary identity signature', () => {
  expect(createDemoIdentities()[0].textSignature).toContain('Comail Demo');
  expect(createDemoIdentities()[0].htmlSignature).toContain('Comail Demo');
});
