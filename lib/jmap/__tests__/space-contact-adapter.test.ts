import { describe, expect, it, vi } from 'vitest';
import { generateVCard, parseVCard } from '@/lib/vcard';
import { SpaceContactAdapter } from '../space-contact-adapter';

const actor = 'did:plc:abcdefghijklmnopqrstuvwx';
const id = 'urn:uuid:11111111-1111-4111-8111-111111111111';
const card = { '@type': 'Card', version: '1.0', uid: id, name: { full: 'Zoë 林' }, 'example.test:custom': { value: 'keep' } };
const book = { actorDID: actor, addressBookId: 'personal', state: 'state-1', contacts: [{ id, card }] };

describe('private contact adapter', () => {
  it('uses the existing contact shape and retains custom card fields', async () => {
    const adapter = new SpaceContactAdapter(() => 1, async () => Response.json(book));
    expect(await adapter.addressBooks()).toEqual([expect.objectContaining({ id: 'personal', isDefault: true })]);
    const contacts = await adapter.contacts();
    expect(contacts).toEqual([expect.objectContaining({
      id,
      uid: id,
      addressBookIds: { personal: true },
      name: card.name,
      'example.test:custom': card['example.test:custom'],
    })]);
    expect(() => generateVCard(contacts!)).toThrow(/example\.test:custom/);
  });

  it('returns no private authority only for explicit absent configuration', async () => {
    const adapter = new SpaceContactAdapter(() => 0, async () => Response.json({ error: 'not_configured' }, { status: 404 }));
    expect(await adapter.configured()).toBe(false);
    const denied = new SpaceContactAdapter(() => 0, async () => Response.json({ error: 'not_found' }, { status: 404 }));
    await expect(denied.configured()).rejects.toThrow();
  });

  it('keeps the observed base and preserves unknown fields on partial edits', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return Response.json(book);
      const request = JSON.parse(String(init.body));
      return Response.json({ ...book, state: 'state-2', contacts: [{ id, card: request.card }] });
    });
    const adapter = new SpaceContactAdapter(() => 0, fetcher);
    await adapter.contacts();
    await adapter.update(id, { name: { full: 'Changed' }, notes: undefined });
    const request = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(request.baseState).toBe('state-1');
    expect(request.card['example.test:custom']).toEqual(card['example.test:custom']);
    expect(request.card).not.toHaveProperty('id');
    expect(request.card).not.toHaveProperty('addressBookIds');
    expect(request.card).not.toHaveProperty('notes');
  });

  it('retries lost create replies with the exact same request and contact ID', async () => {
    let lost = true;
    const requests: string[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      if (!init?.body) return Response.json({ ...book, contacts: [] });
      requests.push(String(init.body));
      if (lost) { lost = false; throw new Error('lost successful reply'); }
      const request = JSON.parse(String(init.body));
      return Response.json({ ...book, state: 'state-2', contacts: [{ id: request.contactId, card: request.card }] });
    };
    const adapter = new SpaceContactAdapter(() => 0, fetcher);
    await expect(adapter.create({ name: { full: 'New' } })).rejects.toThrow();
    const result = await adapter.create({ name: { full: 'New' } });
    expect(requests[1]).toBe(requests[0]);
    expect(result.uid).toBe(JSON.parse(requests[0]).contactId);
  });

  it('never accepts a successful write response that lacks the intended change', async () => {
    const adapter = new SpaceContactAdapter(() => 0, async () => Response.json(book));
    await adapter.contacts();
    await expect(adapter.update(id, { name: { full: 'Changed' } })).rejects.toMatchObject({ code: 'unverified_change' });
    const deletion = new SpaceContactAdapter(() => 0, async () => Response.json(book));
    await expect(deletion.remove(id)).rejects.toMatchObject({ code: 'unverified_change' });
  });

  it('confirms an exact retry after a later edit and asks the caller to reload', async () => {
    let lost = true;
    const requests: string[] = [];
    const laterCard = { ...card, name: { full: 'Later edit' } };
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json(book);
      requests.push(String(init.body));
      if (lost) { lost = false; throw new Error('lost successful reply'); }
      const accepted = JSON.parse(String(init.body));
      return Response.json({ ...book, state: 'state-3', contacts: [{ id, card: requests.length === 2 ? laterCard : accepted.card }], acceptedRequest: accepted });
    });
    await expect(adapter.update(id, { name: { full: 'Accepted edit' } })).rejects.toThrow();
    await expect(adapter.update(id, { name: { full: 'Accepted edit' } })).rejects.toMatchObject({ code: 'conflict' });
    expect(requests[1]).toBe(requests[0]);
    // A subsequent change uses the newer accepted book, not the old retry body.
    await adapter.update(id, { notes: { next: { note: 'next change' } } });
    expect(JSON.parse(requests[2]).baseState).toBe('state-3');
    expect(JSON.parse(requests[2]).card.name).toEqual(laterCard.name);
  });

  it('finishes a deleted create without returning a card that could resurrect it', async () => {
    let applied = 0;
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json({ ...book, contacts: [] });
      const accepted = JSON.parse(String(init.body));
      return Response.json({ ...book, state: 'state-3', contacts: ++applied === 1 ? [] : [{ id: accepted.contactId, card: accepted.card }], acceptedRequest: accepted });
    });
    await expect(adapter.create({ uid: id, name: { full: 'Accepted create' } })).rejects.toMatchObject({ code: 'conflict' });
    const nextID = 'urn:uuid:22222222-2222-4222-8222-222222222222';
    await expect(adapter.create({ uid: nextID, name: { full: 'New create' } })).resolves.toMatchObject({ uid: nextID });
  });

  it('retries an accepted update after reloading a later deletion', async () => {
    let lost = true;
    const requests: string[] = [];
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json({ ...book, contacts: lost ? book.contacts : [] });
      requests.push(String(init.body));
      if (lost) { lost = false; throw new Error('lost successful reply'); }
      return Response.json({ ...book, state: 'state-3', contacts: [], acceptedRequest: JSON.parse(String(init.body)) });
    });
    await expect(adapter.update(id, { name: { full: 'Accepted edit' } })).rejects.toThrow();
    expect(await adapter.contacts()).toEqual([]);
    await expect(adapter.update(id, { name: { full: 'Accepted edit' } })).rejects.toMatchObject({ code: 'conflict' });
    expect(requests[1]).toBe(requests[0]);
  });

  it('rejects a changed accepted request even if the live card matches', async () => {
    for (const changed of ['requestId', 'baseState', 'operation', 'contactId', 'card']) {
      const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
        if (!init?.body) return Response.json(book);
        const request = JSON.parse(String(init.body));
        return Response.json({ ...book, contacts: [{ id, card: request.card }], acceptedRequest: { ...request, [changed]: changed === 'card' ? card : 'different' } });
      });
      await expect(adapter.update(id, { name: { full: 'Accepted edit' } })).rejects.toMatchObject({ code: 'unverified_change' });
    }
  });

  it('rejects a delete confirmation whose book still contains the tombstoned ID', async () => {
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => Response.json({
      ...book, ...(init?.body ? { acceptedRequest: JSON.parse(String(init.body)) } : {}),
    }));
    await expect(adapter.remove(id)).rejects.toMatchObject({ code: 'unverified_change' });
  });

  it('denies unsupported media and foreign address books before writes', async () => {
    const fetcher = vi.fn(async () => Response.json(book));
    const adapter = new SpaceContactAdapter(() => 0, fetcher);
    await adapter.contacts();
    await expect(adapter.create({ media: {} })).rejects.toThrow();
    await expect(adapter.create({ addressBookIds: { foreign: true } })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not switch a configured authority to legacy or another actor', async () => {
    let slot = 0;
    const fetcher = vi.fn(async () => Response.json(book));
    const adapter = new SpaceContactAdapter(() => slot, fetcher);
    await adapter.contacts();
    slot = 1;
    await expect(adapter.contacts()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an account switch while the first book response is in flight', async () => {
    let slot = 0;
    const fetcher = vi.fn(async () => {
      slot = 1;
      return Response.json(book);
    });
    const adapter = new SpaceContactAdapter(() => slot, fetcher);
    await expect(adapter.contacts()).rejects.toMatchObject({ code: 'account_changed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('lets the user reload after a rejected stale edit without losing a pending accepted write', async () => {
    let stale = true;
    const fetcher = async (_url: string, init?: RequestInit) => {
      if (!init?.body) return Response.json({ ...book, state: stale ? 'state-1' : 'state-2' });
      if (stale) { stale = false; return Response.json({ error: 'conflict' }, { status: 409 }); }
      const request = JSON.parse(String(init.body));
      expect(request.baseState).toBe('state-2');
      return Response.json({ ...book, state: 'state-3', contacts: [{ id, card: request.card }] });
    };
    const adapter = new SpaceContactAdapter(() => 0, fetcher);
    await adapter.contacts();
    await expect(adapter.update(id, { name: { full: 'Stale' } })).rejects.toMatchObject({ code: 'conflict' });
    await adapter.contacts();
    await expect(adapter.update(id, { name: { full: 'Reviewed new version' } })).resolves.toBeUndefined();
  });

  it('round trips supported vCard data through the private contact adapter', async () => {
    const imported = parseVCard([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Zoë 李',
      'N:李;Zoë;玲;;',
      'EMAIL;TYPE=WORK,HOME:zoe@example.test',
      'TEL;TYPE=WORK,CELL:+1-555-0100',
      'ORG:Example;Research',
      'ADR;TYPE=HOME:;;Main St;Montréal;QC;H2X;CA',
      'NOTE:Long-lived contact',
      'CATEGORIES:friends',
      `UID:${id}`,
      'END:VCARD',
    ].join('\r\n'))[0];
    let savedCard: Record<string, unknown> | undefined;
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json({ ...book, contacts: [] });
      const request = JSON.parse(String(init.body));
      savedCard = request.card;
      return Response.json({ ...book, state: 'state-2', contacts: [{ id: request.contactId, card: savedCard }] });
    });

    const stored = await adapter.create(imported);
    const reimported = parseVCard(generateVCard([stored]))[0];

    expect(savedCard?.uid).toBe(id);
    expect(reimported.name?.full).toBe('Zoë 李');
    expect(reimported.name?.components).toEqual(imported.name?.components);
    expect(reimported.emails).toMatchObject({
      e0: { address: 'zoe@example.test', contexts: { work: true, private: true } },
    });
    expect(reimported.phones).toMatchObject({
      p0: { number: '+1-555-0100', contexts: { work: true }, features: { mobile: true } },
    });
    expect(reimported.organizations?.o0).toEqual(imported.organizations?.o0);
    expect(reimported.addresses?.a0).toMatchObject({
      street: 'Main St',
      locality: 'Montréal',
      region: 'QC',
      postcode: 'H2X',
      country: 'CA',
      contexts: { private: true },
    });
    expect(reimported.notes?.n0?.note).toBe('Long-lived contact');
    expect(reimported.keywords).toEqual({ friends: true });
  });
});


describe('private contact link round trips', () => {
  const linkedCard = { ...card,
    calendars: {
      primary: { kind: 'calendar', uri: 'https://example.test/primary', mediaType: 'text/calendar' },
      secondary: { kind: 'calendar', uri: 'https://example.test/secondary' },
      busy: { kind: 'freeBusy', uri: 'https://example.test/busy', contexts: { work: true } },
    },
    schedulingAddresses: {
      work: { uri: 'mailto:work@example.test', pref: 1 },
      home: { uri: 'mailto:home@example.test', contexts: { private: true } },
    },
    directories: {
      primary: { kind: 'entry', uri: 'https://example.test/card', mediaType: 'text/vcard' },
      other: { kind: 'entry', uri: 'https://example.test/other' },
    },
  };

  it.each([false, true])('preserves additional links and properties when editing displayed links: %s', async changed => {
    let saved: typeof linkedCard | undefined;
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json({ ...book, contacts: [{ id, card: linkedCard }] });
      saved = JSON.parse(String(init.body)).card;
      return Response.json({ ...book, state: 'state-2', contacts: [{ id, card: saved }] });
    });
    const contacts = await adapter.contacts();
    await adapter.update(id, {
      calendarUri: changed ? 'https://example.test/new' : contacts![0].calendarUri,
      freeBusyUri: contacts![0].freeBusyUri,
      schedulingUri: changed ? 'mailto:new@example.test' : contacts![0].schedulingUri,
      source: changed ? 'https://example.test/new-card' : contacts![0].source,
    });
    expect(saved?.calendars).toEqual({ ...linkedCard.calendars,
      primary: { ...linkedCard.calendars.primary, uri: changed ? 'https://example.test/new' : linkedCard.calendars.primary.uri } });
    expect(saved?.schedulingAddresses).toEqual({ ...linkedCard.schedulingAddresses,
      work: { ...linkedCard.schedulingAddresses.work, uri: changed ? 'mailto:new@example.test' : linkedCard.schedulingAddresses.work.uri } });
    expect(saved?.directories).toEqual({ ...linkedCard.directories,
      primary: { ...linkedCard.directories.primary, uri: changed ? 'https://example.test/new-card' : linkedCard.directories.primary.uri } });
    expect(linkedCard.calendars.primary.uri).toBe('https://example.test/primary');
  });
});


describe('private contact link removal', () => {
  it('clears the displayed URI without removing other calendar kinds or changing an unmentioned source', async () => {
    const linked = { ...card, calendars: {
      only: { kind: 'calendar', uri: 'https://example.test/cal' },
      busy: { kind: 'freeBusy', uri: 'https://example.test/busy' },
    }, directories: { source: { kind: 'entry', uri: 'https://example.test/card' } } };
    let saved: Record<string, unknown> | undefined;
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json({ ...book, contacts: [{ id, card: linked }] });
      saved = JSON.parse(String(init.body)).card;
      return Response.json({ ...book, state: 'state-2', contacts: [{ id, card: saved }] });
    });
    await adapter.update(id, { calendarUri: undefined });
    expect(saved?.calendars).toEqual({ busy: linked.calendars.busy });
    expect(saved?.directories).toEqual(linked.directories);
    await adapter.update(id, { freeBusyUri: undefined });
    expect(saved).not.toHaveProperty('calendars');
  });
});


describe('private contact link creation', () => {
  it('keeps an occupied entry ID when adding a different calendar kind', async () => {
    let saved: Record<string, unknown> | undefined;
    const adapter = new SpaceContactAdapter(() => 0, async (_url, init) => {
      if (!init?.body) return Response.json({ ...book, contacts: [] });
      const request = JSON.parse(String(init.body));
      saved = request.card;
      return Response.json({ ...book, state: 'state-2', contacts: [{ id: request.contactId, card: saved }] });
    });
    await adapter.create({ uid: id, calendarUri: 'https://example.test/cal',
      calendars: { cal: { kind: 'freeBusy', uri: 'https://example.test/busy' } },
      schedulingUri: 'mailto:zoe@example.test', source: 'https://example.test/source' });
    expect(saved?.calendars).toEqual({ cal: { kind: 'freeBusy', uri: 'https://example.test/busy' },
      cal1: { '@type': 'Calendar', kind: 'calendar', uri: 'https://example.test/cal' } });
    expect(saved?.schedulingAddresses).toEqual({ sched: { '@type': 'SchedulingAddress', uri: 'mailto:zoe@example.test' } });
    expect(saved?.directories).toEqual({ source: { '@type': 'Directory', kind: 'entry', uri: 'https://example.test/source' } });
  });
});

describe('private contacts consent', () => {
 it('returns an explicit consent action and never falls back to Stalwart', async () => {
  const authorizationUrl=`https://inbox.comail.at/oauth/contacts/tickets/${'A'.repeat(43)}`;
  const fetcher=vi.fn(async (path:string)=>path.includes('/authorization?') ? Response.json({status:'authorization_required',authorizationUrl}) : Response.json({error:'authorization_required'},{status:409}));
  const adapter=new SpaceContactAdapter(()=>0,fetcher);
  await expect(adapter.addressBooks()).rejects.toMatchObject({code:'authorization_required',authorizationUrl});
  expect(fetcher.mock.calls.map(([path])=>path)).toEqual(['/api/contacts/book?slot=0','/api/contacts/authorization?slot=0']);
 });
});
