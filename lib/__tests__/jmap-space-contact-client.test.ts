import { describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { SpaceContactAdapter, SpaceContactError } from '@/lib/jmap/space-contact-adapter';
import { useContactStore } from '@/stores/contact-store';

function setup() {
  const client = new JMAPClient('https://mail.test', 'alice@example.test', 'synthetic');
  Object.assign(client, { accountId: 'account-1', accounts: {}, session: { primaryAccounts: {} } });
  const adapter = (client as unknown as { spaceContactAdapter: SpaceContactAdapter }).spaceContactAdapter;
  const jmap = vi.spyOn(client as unknown as { request: () => Promise<unknown> }, 'request').mockRejectedValue(new Error('unexpected Stalwart request'));
  return { client, adapter, jmap };
}

describe('existing contact client with private authority', () => {
  it('does not restore a contact deleted after its accepted private create', async () => {
    const { client, adapter, jmap } = setup();
    const id = 'urn:uuid:11111111-1111-4111-8111-111111111111';
    Object.assign(adapter, { getCookieSlot: () => 0, fetcher: async (_url: string, init?: RequestInit) => Response.json({
      actorDID: 'did:plc:abcdefghijklmnopqrstuvwx', addressBookId: 'personal', state: 'state-3', contacts: [],
      ...(init?.body ? { acceptedRequest: JSON.parse(String(init.body)) } : {}),
    }) });
    useContactStore.setState({ contacts: [], addressBooks: [], error: null, isLoading: false });
    await expect(useContactStore.getState().createContact(client, { uid: id, name: { full: 'Accepted create' } })).rejects.toMatchObject({ code: 'conflict' });
    expect(useContactStore.getState().contacts).toEqual([]);
    expect(jmap).not.toHaveBeenCalled();
  });

  it('loads the existing contact screen through canonical books and cards', async () => {
    const { client, adapter, jmap } = setup();
    const contacts = [{ id: 'urn:uuid:11111111-1111-4111-8111-111111111111', addressBookIds: { personal: true } }];
    vi.spyOn(adapter, 'addressBooks').mockResolvedValue([{ id: 'personal', name: 'Personal contacts', isDefault: true }]);
    vi.spyOn(adapter, 'contacts').mockResolvedValue(contacts);
    expect(await client.getAllAddressBooks()).toEqual([expect.objectContaining({ id: 'personal' })]);
    expect(await client.getAllContacts()).toEqual([expect.objectContaining(contacts[0])]);
    expect(jmap).not.toHaveBeenCalled();
  });

  it('routes import, edits and deletes to one writer', async () => {
    const { client, adapter, jmap } = setup();
    vi.spyOn(adapter, 'configured').mockResolvedValue(true);
    const contact = { id: 'urn:uuid:11111111-1111-4111-8111-111111111111', addressBookIds: { personal: true } };
    const create = vi.spyOn(adapter, 'create').mockResolvedValue(contact);
    const update = vi.spyOn(adapter, 'update').mockResolvedValue(undefined);
    const remove = vi.spyOn(adapter, 'remove').mockResolvedValue(undefined);
    await expect(client.createContact({ name: { full: 'Import' } })).resolves.toEqual(contact);
    await client.updateContact(contact.id, { name: { full: 'Edit' } });
    await client.deleteContact(contact.id);
    expect(create).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
    expect(jmap).not.toHaveBeenCalled();
  });

  it('surfaces configured-source failure through ordinary list methods', async () => {
    const { client, adapter, jmap } = setup();
    vi.spyOn(adapter, 'addressBooks').mockRejectedValue(new SpaceContactError('provider_unavailable'));
    vi.spyOn(adapter, 'contacts').mockRejectedValue(new SpaceContactError('provider_unavailable'));
    await expect(client.getAddressBooks()).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(client.getAllAddressBooks()).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(client.getContacts()).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(client.getAllContacts()).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(jmap).not.toHaveBeenCalled();
  });

  it('rejects unsupported address-book management and shared-account writes', async () => {
    const { client, adapter, jmap } = setup();
    vi.spyOn(adapter, 'configured').mockResolvedValue(true);
    await expect(client.createAddressBook('Other')).rejects.toMatchObject({ code: 'unsupported_address_book_operation' });
    await expect(client.createContact({}, 'other-account')).rejects.toMatchObject({ code: 'unsupported_account' });
    expect(jmap).not.toHaveBeenCalled();
  });
});
