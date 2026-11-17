import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceContactError } from '@/lib/jmap/space-contact-adapter';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { ContactCard } from '@/lib/jmap/types';
import { useContactStore } from '../contact-store';

const server = 'https://mail.example.test';
const aliceId = 'alice@example.test@mail.example.test';
const bobId = 'bob@example.test@mail.example.test';
function contact(id: string, name: string, localAccountId?: string): ContactCard {
  return { id, localAccountId, addressBookIds: {}, name: { full: name },
    emails: { e0: { address: `${name.toLowerCase()}@example.test` } } } as ContactCard;
}
function failing(code: string): IJMAPClient {
  return { getUsername: () => 'alice@example.test', getServerUrl: () => server,
    getAllContacts: vi.fn().mockRejectedValue(new SpaceContactError(code)) } as unknown as IJMAPClient;
}

beforeEach(() => {
  useContactStore.setState({ contacts: [], selectedContactId: null, selectedContactIds: new Set(),
    lastSelectedContactId: null, recentRecipients: [], directoryPrincipals: [], error: null });
});

describe('private contact access withdrawal', () => {
  it.each(['forbidden', 'unauthorized', 'authorization_required'])('removes denied contacts and their selections on %s', async code => {
    useContactStore.setState({ contacts: [contact('same', 'Alice')], selectedContactId: 'same',
      selectedContactIds: new Set(['same']), lastSelectedContactId: 'same' });
    await useContactStore.getState().fetchContacts(failing(code));
    const state = useContactStore.getState();
    expect(state.contacts).toEqual([]);
    expect(state.selectedContactId).toBeNull();
    expect([...state.selectedContactIds]).toEqual([]);
    expect(state.lastSelectedContactId).toBeNull();
    expect(state.getAutocomplete('alice')).toEqual([]);
  });

  it('keeps another account when a single-account refresh is denied', async () => {
    const alice = contact(`${aliceId}::same`, 'Alice', aliceId);
    const bob = contact(`${bobId}::same`, 'Bob', bobId);
    useContactStore.setState({ contacts: [alice, bob], selectedContactId: bob.id,
      selectedContactIds: new Set([alice.id, bob.id]), lastSelectedContactId: bob.id });
    await useContactStore.getState().fetchContacts(failing('forbidden'));
    const state = useContactStore.getState();
    expect(state.contacts).toEqual([bob]);
    expect(state.selectedContactId).toBe(bob.id);
    expect([...state.selectedContactIds]).toEqual([bob.id]);
    expect(state.lastSelectedContactId).toBe(bob.id);
    expect(state.getAutocomplete('alice')).toEqual([]);
    expect(state.getAutocomplete('bob')).toHaveLength(1);
  });

  it('retains cached contacts and selections on a transient provider failure', async () => {
    const saved = contact('same', 'Alice');
    useContactStore.setState({ contacts: [saved], selectedContactId: 'same',
      selectedContactIds: new Set(['same']), lastSelectedContactId: 'same' });
    await useContactStore.getState().fetchContacts(failing('provider_unavailable'));
    const state = useContactStore.getState();
    expect(state.contacts).toEqual([saved]);
    expect(state.selectedContactId).toBe('same');
    expect([...state.selectedContactIds]).toEqual(['same']);
    expect(state.getAutocomplete('alice')).toHaveLength(1);
  });

  it('removes only the denied account and its selection from aggregated contacts', async () => {
    const alice = contact(`${aliceId}::same`, 'Alice', aliceId);
    const bob = contact(`${bobId}::same`, 'Bob', bobId);
    useContactStore.setState({ contacts: [alice, bob], selectedContactId: alice.id,
      selectedContactIds: new Set([alice.id, bob.id]), lastSelectedContactId: alice.id });
    const bobClient = { getAllContacts: vi.fn().mockResolvedValue([contact('same', 'Bob')]) } as unknown as IJMAPClient;
    await useContactStore.getState().fetchAllAccountsContacts([
      { client: failing('forbidden'), localAccountId: aliceId }, { client: bobClient, localAccountId: bobId },
    ]);
    const state = useContactStore.getState();
    expect(state.contacts.map(item => item.id)).toEqual([bob.id]);
    expect(state.selectedContactId).toBeNull();
    expect([...state.selectedContactIds]).toEqual([bob.id]);
    expect(state.lastSelectedContactId).toBeNull();
    expect(state.getAutocomplete('alice')).toEqual([]);
    expect(state.getAutocomplete('bob')).toHaveLength(1);
  });
});
