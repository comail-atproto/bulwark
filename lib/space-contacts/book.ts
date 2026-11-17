export interface SpaceContactBook {
  actorDID: string;
  addressBookId: string;
  state: string;
  contacts: Array<{ id: string; card: Record<string, unknown> }>;
}

export const CONTACT_UID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSpaceContactBook(value: unknown): value is SpaceContactBook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const book = value as SpaceContactBook;
  if (typeof book.actorDID !== 'string' || !/^did:(plc|web):[^\s]+$/.test(book.actorDID)
    || typeof book.addressBookId !== 'string' || !book.addressBookId || book.addressBookId.length > 128
    || typeof book.state !== 'string' || !book.state || book.state.length > 256
    || !Array.isArray(book.contacts) || book.contacts.length > 2048) return false;
  const seen = new Set<string>();
  for (const contact of book.contacts) {
    if (!contact || typeof contact.id !== 'string' || !CONTACT_UID.test(contact.id) || seen.has(contact.id)
      || !contact.card || typeof contact.card !== 'object' || Array.isArray(contact.card)
      || contact.card['@type'] !== 'Card' || contact.card.version !== '1.0' || contact.card.uid !== contact.id
      || ['media', 'photos', 'photo', 'avatar', 'avatars'].some(key => key in contact.card)
      || new TextEncoder().encode(JSON.stringify(contact.card)).length > 64 * 1024) return false;
    seen.add(contact.id);
  }
  return true;
}
