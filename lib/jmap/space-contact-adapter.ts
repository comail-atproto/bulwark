import { isPersonalAuthorizationUrl } from '@/lib/groupware/authorization';
import { apiFetch } from '@/lib/browser-navigation';
import { generateUUID } from '@/lib/utils';
import { CONTACT_UID, isSpaceContactBook, type SpaceContactBook } from '@/lib/space-contacts/book';
import { contactFromWire } from './contact-wire';
import { contactToSpaceWire } from '@/lib/space-contacts/wire';
import type { AddressBook, ContactCard } from './types';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Change = { requestId: string; baseState: string; operation: 'create' | 'update' | 'delete'; contactId: string; card?: Record<string, unknown> };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export class SpaceContactError extends Error {
  constructor(readonly code: string, readonly authorizationUrl?: string) {
    const messages: Record<string, string> = {
      authorization_required: 'Connect this account’s private address book to continue.',
      conflict: 'Your address book changed. Reload it before saving.',
      pending_change: 'Retry your previous contact change before making another edit.',
      unsupported_card: 'This contact includes an unsupported ID, format, or photo.',
      unsupported_address_book: 'This private address book supports one personal book.',
      unsupported_address_book_operation: 'This private address book cannot be renamed, deleted, or expanded yet.',
      unsupported_sharing: 'This private address book does not support sharing yet.',
      unsupported_account: 'Choose the account that owns this address book.',
      account_changed: 'The account changed. Reopen Contacts to continue.',
    };
    super(messages[code] ?? 'Your private address book is unavailable. Try again.');
    this.name = 'SpaceContactError';
  }
}

export class SpaceContactAdapter {
  private book: SpaceContactBook | null | undefined;
  private slot: number | undefined;
  private consent?: { slot: number; expires: number; url: Promise<string> };
  private pending?: { input: string; change: Change };

  constructor(private readonly getCookieSlot: () => number | undefined, private readonly fetcher: Fetcher = apiFetch) {}

  async configured(): Promise<boolean> {
    this.checkSlot();
    if (this.book === undefined) await this.load();
    return this.book != null;
  }

  async addressBooks(): Promise<AddressBook[] | null> {
    const book = await this.load();
    return book ? [{ id: book.addressBookId, name: 'Personal contacts', isDefault: true,
      myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false } }] : null;
  }

  async contacts(addressBookId?: string): Promise<ContactCard[] | null> {
    const book = await this.load();
    if (!book) return null;
    if (addressBookId !== undefined && addressBookId !== book.addressBookId) throw new SpaceContactError('unsupported_address_book');
    return book.contacts.map(({ id, card }) => contactFromWire({ ...card, id, uid: id, addressBookIds: { [book.addressBookId]: true } }));
  }

  async create(contact: Partial<ContactCard>): Promise<ContactCard> {
    const book = await this.requireBook();
    this.checkAddressBooks(contact, book);
    const input = canonical({ operation: 'create', contact });
    const id = this.pending?.input === input ? this.pending.change.contactId : contact.uid || `urn:uuid:${generateUUID()}`;
    const card = this.card(contact, id);
    const next = await this.apply(input, { operation: 'create', contactId: id, card });
    return contactFromWire({ ...next.contacts.find(item => item.id === id)!.card, id, uid: id, addressBookIds: { [next.addressBookId]: true } });
  }

  async update(id: string, updates: Partial<ContactCard>): Promise<void> {
    const book = await this.requireBook();
    this.checkAddressBooks(updates, book);
    const input = canonical({ operation: 'update', id, updates });
    if (this.pending?.input === input) {
      await this.apply(input, this.pending.change);
      return;
    }
    const current = book.contacts.find(contact => contact.id === id);
    if (!current) throw new SpaceContactError('not_found');
    const card = { ...current.card };
    for (const [key, value] of Object.entries(contactToSpaceWire(updates, 'update', current.card))) {
      if (['id', 'addressBookIds'].includes(key)) continue;
      if (value === null) delete card[key]; else card[key] = value;
    }
    const validated = this.card(card as Partial<ContactCard>, id);
    await this.apply(input, { operation: 'update', contactId: id, card: validated });
  }

  async remove(id: string): Promise<void> {
    await this.apply(canonical({ operation: 'delete', id }), { operation: 'delete', contactId: id });
  }

  async rebuild(): Promise<void> {
    const previous = await this.requireBook();
    const book = await this.request('/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    this.accept(book, previous);
  }

  private checkSlot(): void {
    const current = this.getCookieSlot();
    if (this.book && current !== this.slot) throw new SpaceContactError('account_changed');
    if (!this.book) this.slot = current;
  }

  private async load(): Promise<SpaceContactBook | null> {
    this.checkSlot();
    if (this.slot === undefined) { this.book = null; return null; }
    const book = await this.request('/book');
    if (book === null) {
      if (this.book) throw new SpaceContactError('authority_unavailable');
      this.book = null;
      return null;
    }
    this.accept(book, this.book);
    return book;
  }

  private accept(value: unknown, previous?: SpaceContactBook | null): asserts value is SpaceContactBook {
    if (!isSpaceContactBook(value) || previous && (previous.actorDID !== value.actorDID || previous.addressBookId !== value.addressBookId)) throw new SpaceContactError('invalid_response');
    this.book = value;
  }

  private async requireBook(): Promise<SpaceContactBook> {
    if (!await this.configured() || !this.book) throw new SpaceContactError('not_configured');
    return this.book;
  }

  private checkAddressBooks(contact: Partial<ContactCard>, book: SpaceContactBook): void {
    if (contact.addressBookIds && Object.entries(contact.addressBookIds).some(([id, included]) => included !== true || id !== book.addressBookId)) throw new SpaceContactError('unsupported_address_book');
  }

  private card(contact: Partial<ContactCard>, id: string): Record<string, unknown> {
    const card = contactToSpaceWire(contact, 'create');
    delete card.id; delete card.addressBookIds;
    if (!CONTACT_UID.test(id) || card.uid !== undefined && card.uid !== id
      || card.version !== undefined && card.version !== '1.0' || card['@type'] !== undefined && card['@type'] !== 'Card'
      || ['media', 'photo', 'photos', 'avatar', 'avatars'].some(key => key in card)) throw new SpaceContactError('unsupported_card');
    return { ...card, '@type': 'Card', version: '1.0', uid: id };
  }

  private async apply(input: string, change: Omit<Change, 'requestId' | 'baseState'>): Promise<SpaceContactBook> {
    const book = await this.requireBook();
    if (this.pending && this.pending.input !== input) throw new SpaceContactError('pending_change');
    // Keep exact retry identity and the user's observed base until readback succeeds.
    this.pending ??= { input, change: { ...change, requestId: generateUUID(), baseState: book.state } };
    const accepted = this.pending.change;
    let value: SpaceContactBook | null;
    try {
      value = await this.request('/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accepted) });
    } catch (error) {
      if (error instanceof SpaceContactError && ['conflict', 'invalid_request', 'unsupported_operation'].includes(error.code)) this.pending = undefined;
      throw error;
    }
    if (!isSpaceContactBook(value) || value.actorDID !== book.actorDID || value.addressBookId !== book.addressBookId) throw new SpaceContactError('invalid_response');
    const contact = value.contacts.find(item => item.id === accepted.contactId);
    const changed = accepted.operation === 'delete' ? contact !== undefined : !contact || canonical(contact.card) !== canonical(accepted.card);
    if ('acceptedRequest' in value) {
      if (canonical(value.acceptedRequest) !== canonical(accepted)) throw new SpaceContactError('unverified_change');
      if (accepted.operation === 'delete' && contact !== undefined) throw new SpaceContactError('unverified_change');
    } else if (changed) throw new SpaceContactError('unverified_change');
    this.book = value;
    this.pending = undefined;
    // Callers optimistically apply successful writes. Reload a newer edit or
    // deletion without keeping the already-confirmed request pending.
    if (changed) throw new SpaceContactError('conflict');
    return value;
  }

  private startAuthorization(slot: number): Promise<string> {
    if (this.consent?.slot === slot && this.consent.expires > Date.now()) return this.consent.url;
    const url = (async () => {
      const response = await this.fetcher(`/api/contacts/authorization?slot=${slot}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const value: unknown = await response.json();
      if (this.getCookieSlot() !== slot) throw new SpaceContactError('account_changed');
      const result = value as { status?: unknown; authorizationUrl?: unknown } | null;
      if (!response.ok || result?.status !== 'authorization_required' || !isPersonalAuthorizationUrl(result.authorizationUrl, 'contacts')) throw new SpaceContactError('invalid_response');
      return result.authorizationUrl;
    })();
    this.consent = { slot, expires: Date.now() + 60_000, url };
    void url.catch(() => { if (this.consent?.url === url) this.consent = undefined; });
    return url;
  }

  private async request(path: string, init?: RequestInit): Promise<SpaceContactBook | null> {
    this.checkSlot();
    if (this.slot === undefined) throw new SpaceContactError('account_unavailable');
    const slot = this.slot;
    const response = await this.fetcher(`/api/contacts${path}?slot=${slot}`, init);
    const value: unknown = await response.json();
    if (this.getCookieSlot() !== slot) throw new SpaceContactError('account_changed');
    if (response.status === 404 && path === '/book' && value && typeof value === 'object' && 'error' in value && value.error === 'not_configured') return null;
    if (response.status === 409 && value && typeof value === 'object' && 'error' in value && value.error === 'authorization_required') {
      throw new SpaceContactError('authorization_required', await this.startAuthorization(slot));
    }
    if (!response.ok) throw new SpaceContactError(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'provider_unavailable');
    if (!isSpaceContactBook(value)) throw new SpaceContactError('invalid_response');
    return value;
  }
}
