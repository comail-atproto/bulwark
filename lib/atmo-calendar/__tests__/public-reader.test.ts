import { beforeEach, describe, expect, it, vi } from 'vitest';

const guardedFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/security/url-guard', () => ({ fetchPublicUrl: guardedFetch }));

import { readPublicAtmoCalendar } from '../public-reader';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const OTHER_DID = 'did:plc:bcdefghijklmnopqrstuvwxy';
const PDS = 'https://pds.example';
const AFTER = '2026-10-01T00:00:00-04:00';
const BEFORE = '2026-11-01T00:00:00-04:00';
const EVENT_COLLECTION = 'community.lexicon.calendar.event';
const RSVP_COLLECTION = 'community.lexicon.calendar.rsvp';
const CID = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function eventRecord(did = DID, rkey = '3m3z2a2b3c4d5', overrides: Record<string, unknown> = {}) {
  return {
    uri: `at://${did}/${EVENT_COLLECTION}/${rkey}`,
    cid: CID,
    value: {
      $type: EVENT_COLLECTION,
      name: 'A public event',
      createdAt: '2026-10-08T09:00:00Z',
      startsAt: '2026-10-12T18:00:00-04:00',
      ...overrides,
    },
  };
}

function rsvpRecord(rkey: string, eventUri: string, status: 'going' | 'interested' | 'notgoing', cid = CID) {
  return {
    uri: `at://${DID}/${RSVP_COLLECTION}/${rkey}`,
    cid,
    value: {
      $type: RSVP_COLLECTION,
      subject: { uri: eventUri, cid: 'bafyreicccccccccccccccccccccccccccccccccccccccccccccccccccc' },
      status: `${RSVP_COLLECTION}#${status}`,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function didDocument(did = DID, endpoint = PDS, serviceId = `${did}#atproto_pds`) {
  return {
    id: did,
    service: [{ id: serviceId, type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint }],
  };
}

function didDocumentUrl(did = DID): string {
  return did.startsWith('did:plc:') ? `https://plc.directory/${did}` : `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
}

function listResponse(records: unknown[], cursor?: string) {
  return jsonResponse({ records, ...(cursor === undefined ? {} : { cursor }) });
}

function installPublicFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  guardedFetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url === undefined) return jsonResponse({});
    return handler(new URL(String(url)), init);
  });
}

function request(actorDid = DID) {
  return readPublicAtmoCalendar({ actorDid, after: AFTER, before: BEFORE });
}

describe('public AT Protocol atmo calendar reader', () => {
  beforeEach(() => guardedFetch.mockReset());

  it('reads hosted events and exposes only public read requests', async () => {
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        expect(url.searchParams.get('repo')).toBe(DID);
        return url.searchParams.get('collection') === EVENT_COLLECTION ? listResponse([eventRecord()]) : listResponse([]);
      }
      return listResponse([]);
    });

    const result = await request();

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ uri: `at://${DID}/${EVENT_COLLECTION}/3m3z2a2b3c4d5`, attendance: 'hosting' });
    expect(guardedFetch).toHaveBeenCalled();
    for (const [url, init] of guardedFetch.mock.calls.filter(([url]) => typeof url === 'string')) {
      expect(String(url).startsWith('https://')).toBe(true);
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).has('authorization')).toBe(false);
      expect(init.signal).toBeDefined();
    }
  });

  it('uses the latest actor RSVP and fetches the event’s current version without comparing the subject CID', async () => {
    const currentUri = `at://${OTHER_DID}/${EVENT_COLLECTION}/3m3z2a2b3c4d5`;
    let currentEventReads = 0;
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.href === didDocumentUrl(OTHER_DID)) return jsonResponse(didDocument(OTHER_DID));
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([])
          : listResponse([
            rsvpRecord('3m3z2a2b3c4d6', currentUri, 'going'),
            rsvpRecord('3m3z2a2b3c4d7', currentUri, 'interested'),
          ]);
      }
      if (url.pathname.endsWith('/com.atproto.repo.getRecord')) {
        currentEventReads += 1;
        return jsonResponse({ uri: currentUri, cid: 'bafyreiddddddddddddddddddddddddddddddddddddddddddddddddddd', value: eventRecord(OTHER_DID).value });
      }
      return jsonResponse({ records: [] });
    });

    const result = await request();

    expect(currentEventReads).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ attendance: 'interested', creatorDid: OTHER_DID, rsvpCid: CID });
    expect(result.events[0].cid).toBe('bafyreiddddddddddddddddddddddddddddddddddddddddddddddddddd');
  });

  it('fetches RSVP targets concurrently while resolving a shared creator once', async () => {
    const keys = ['3m3z2a2b3c4d5', '3m3z2a2b3c4d6'];
    let started = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    installPublicFetch(async (url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.href === didDocumentUrl(OTHER_DID)) return jsonResponse(didDocument(OTHER_DID));
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION ? listResponse([]) : listResponse(
          keys.map((key, index) => rsvpRecord(['3m3z2a2b3c4d7', '3m3z2a2b3c4da'][index], `at://${OTHER_DID}/${EVENT_COLLECTION}/${key}`, 'going')),
        );
      }
      if (url.pathname.endsWith('/com.atproto.repo.getRecord')) {
        started += 1;
        await pending;
        return jsonResponse(eventRecord(OTHER_DID, url.searchParams.get('rkey')!));
      }
      throw new Error('unexpected request');
    });
    const resultPromise = request();
    try {
      await vi.waitFor(() => expect(started).toBe(2), { timeout: 500 });
    } finally {
      release();
    }
    const result = await resultPromise;
    expect(result.events).toHaveLength(2);
    expect(guardedFetch.mock.calls.filter(([url]) => url === didDocumentUrl(OTHER_DID))).toHaveLength(1);
  });

  it('lets the latest notgoing RSVP remove an older RSVP, while hosted events keep hosting precedence', async () => {
    const hostedUri = `at://${DID}/${EVENT_COLLECTION}/3m3z2a2b3c4d5`;
    const otherUri = `at://${OTHER_DID}/${EVENT_COLLECTION}/3m3z2a2b3c4da`;
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.href === didDocumentUrl(OTHER_DID)) return jsonResponse(didDocument(OTHER_DID));
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([eventRecord()])
          : listResponse([
            rsvpRecord('3m3z2a2b3c4d6', hostedUri, 'notgoing'),
            rsvpRecord('3m3z2a2b3c4d7', otherUri, 'going'),
            rsvpRecord('3m3z2a2b3c4db', otherUri, 'notgoing'),
          ]);
      }
      if (url.pathname.endsWith('/com.atproto.repo.getRecord')) return jsonResponse({ uri: otherUri, cid: CID, value: eventRecord(OTHER_DID).value });
      return jsonResponse({ records: [] });
    });

    const result = await request();

    expect(result.events.map((event) => [event.uri, event.attendance])).toEqual([[hostedUri, 'hosting']]);
  });

  it('skips deleted and unavailable third-party RSVP targets', async () => {
    const deletedUri = `at://${OTHER_DID}/${EVENT_COLLECTION}/3m3z2a2b3c4da`;
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.href === didDocumentUrl(OTHER_DID)) return jsonResponse(didDocument(OTHER_DID));
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([])
          : listResponse([rsvpRecord('3m3z2a2b3c4d6', deletedUri, 'going')]);
      }
      return jsonResponse({ error: 'RecordNotFound' }, 400);
    });
    await expect(request()).resolves.toMatchObject({ complete: true, events: [] });

    installPublicFetch((url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.href === didDocumentUrl(OTHER_DID)) return jsonResponse(didDocument(OTHER_DID));
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([])
          : listResponse([rsvpRecord('3m3z2a2b3c4d6', deletedUri, 'going')]);
      }
      return jsonResponse({ error: 'Unavailable' }, 503);
    });
    await expect(request()).resolves.toMatchObject({ complete: false, events: [] });

    installPublicFetch((url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.href === didDocumentUrl(OTHER_DID)) return jsonResponse(didDocument(OTHER_DID));
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([])
          : listResponse([rsvpRecord('3m3z2a2b3c4d6', deletedUri, 'going')]);
      }
      return new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    });
    await expect(request()).resolves.toMatchObject({ complete: false, events: [] });
  });

  it('resolves the first short or fully-qualified PDS service on hostname-only did:web', async () => {
    const webDid = 'did:web:calendar.example.test';
    const webDocUrl = 'https://calendar.example.test/.well-known/did.json';
    let pdsReads = 0;
    installPublicFetch((url) => {
      if (url.href === webDocUrl) {
        return jsonResponse({
          id: webDid,
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS },
            { id: `${webDid}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://ignored.example.test' },
          ],
        });
      }
      if (url.origin === PDS) {
        pdsReads += 1;
        return url.pathname.endsWith('/com.atproto.repo.listRecords')
          ? listResponse(url.searchParams.get('collection') === EVENT_COLLECTION ? [eventRecord(webDid)] : [])
          : listResponse([]);
      }
      throw new Error(`Unexpected public host ${url.origin}`);
    });

    const result = await request(webDid);

    expect(result.events).toHaveLength(1);
    expect(pdsReads).toBe(2);
    expect(guardedFetch.mock.calls.map(([url]) => String(url))).not.toContain('https://ignored.example.test/xrpc/com.atproto.repo.listRecords?repo=');
  });

  it('rejects path, port, localhost, and unsupported-method DIDs before resolution', async () => {
    for (const did of ['did:web:calendar.example.test:path', 'did:web:calendar.example.test%3A8443', 'did:web:localhost', 'did:key:' + 'zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGn' + 'CmCyW92sRJ9pribSF']) {
      await expect(request(did)).rejects.toMatchObject({ code: 'invalid_actor' });
    }
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it('skips unsupported third-party record-subject DID methods without attempting web resolution', async () => {
    const unsupportedUri = 'at://did:key:zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGnCmCyW92sRJ9pribSF/community.lexicon.calendar.event/3m3z2a2b3c4d5';
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl(DID)) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([])
          : listResponse([rsvpRecord('3m3z2a2b3c4d6', unsupportedUri, 'going')]);
      }
      return jsonResponse({});
    });

    await expect(request()).resolves.toMatchObject({ complete: false, events: [] });
    expect(guardedFetch.mock.calls.map(([url]) => String(url)).some((url) => url.includes('did%3Akey'))).toBe(false);
  });

  it('rejects DID documents with non-HTTPS or private PDS endpoints before contacting them', async () => {
    installPublicFetch((url) => url.href === didDocumentUrl()
      ? jsonResponse(didDocument(DID, 'http://127.0.0.1:8080'))
      : listResponse([]));

    await expect(request()).rejects.toMatchObject({ code: 'invalid_pds' });
    expect(guardedFetch).toHaveBeenCalledOnce();
  });

  it('rejects actor URL input, missing PDS identity, redirects, and malformed bodies visibly', async () => {
    await expect(request('https://attacker.example/did.json' as never)).rejects.toMatchObject({ code: 'invalid_actor' });
    expect(guardedFetch).not.toHaveBeenCalled();

    installPublicFetch((url) => url.href === didDocumentUrl() ? jsonResponse({ id: DID, service: [] }) : listResponse([]));
    await expect(request()).rejects.toMatchObject({ code: 'missing_pds' });

    installPublicFetch((url) => url.href === didDocumentUrl() ? jsonResponse(didDocument()) : new Response('', { status: 302, headers: { location: 'https://other.example' } }));
    await expect(request()).rejects.toMatchObject({ code: 'redirect_rejected' });

    installPublicFetch((url) => url.href === didDocumentUrl() ? new Response('{', { headers: { 'content-type': 'application/json' } }) : listResponse([]));
    await expect(request()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('cancels unread redirect bodies and aborts the sibling page fetch after a malformed page', async () => {
    let cancelledBodies = 0;
    installPublicFetch((url) => url.href === didDocumentUrl()
      ? jsonResponse(didDocument())
      : new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
        cancel() { cancelledBodies += 1; },
      }), { status: 302, headers: { 'content-type': 'application/json' } }));
    await expect(request()).rejects.toMatchObject({ code: 'redirect_rejected' });
    expect(cancelledBodies).toBeGreaterThan(0);

    let pendingSignal: AbortSignal | undefined;
    installPublicFetch((url, init) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.searchParams.get('collection') === EVENT_COLLECTION) return jsonResponse({ records: 'malformed' });
      pendingSignal = init.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        pendingSignal?.addEventListener('abort', () => resolve(listResponse([])), { once: true });
      });
    });
    await expect(request()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(pendingSignal?.aborted).toBe(true);
  });

  it('requires timezone offsets and rejects cyclic cursors instead of returning partial success', async () => {
    await expect(readPublicAtmoCalendar({ actorDid: DID, after: '2026-10-01T00:00:00', before: BEFORE }))
      .rejects.toMatchObject({ code: 'invalid_window' });
    await expect(readPublicAtmoCalendar({ actorDid: DID, after: '2026-02-30T00:00:00Z', before: BEFORE }))
      .rejects.toMatchObject({ code: 'invalid_window' });
    await expect(readPublicAtmoCalendar({ actorDid: DID, after: '2025-01-01T00:00:00Z', before: '2026-10-01T00:00:00Z' }))
      .rejects.toMatchObject({ code: 'invalid_window' });

    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) return listResponse([], 'cursor-1');
      return listResponse([]);
    });
    await expect(request()).rejects.toMatchObject({ code: 'pagination_cycle' });

    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([eventRecord(), eventRecord()])
          : listResponse([]);
      }
      return listResponse([]);
    });
    await expect(request()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails visibly on page, record, lookup, byte, and deadline caps', async () => {
    let page = 0;
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) return listResponse([], `cursor-${page++}`);
      return listResponse([]);
    });
    await expect(request()).rejects.toMatchObject({ code: 'page_limit' });

    installPublicFetch((url) => url.href === didDocumentUrl()
      ? jsonResponse(didDocument())
      : new Response(JSON.stringify({ records: Array.from({ length: 101 }, () => eventRecord()) }), { headers: { 'content-type': 'application/json' } }));
    await expect(request()).rejects.toMatchObject({ code: 'invalid_response' });

    let recordPage = 0;
    const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.searchParams.get('collection') !== EVENT_COLLECTION) return listResponse([]);
      const page = recordPage++;
      const records = Array.from({ length: 100 }, (_, index) => {
        const key = page * 100 + index;
        const rkey = `3m3z2a2b3c4${alphabet[Math.floor(key / alphabet.length)]}${alphabet[key % alphabet.length]}`;
        return eventRecord(DID, rkey);
      });
      return listResponse(records, page < 4 ? `record-page-${page}` : undefined);
    });
    await expect(request()).rejects.toMatchObject({ code: 'record_limit' });

    const targetDids = Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index));
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([])
          : listResponse(targetDids.map((suffix) => rsvpRecord(`3m3z2a2b3c4d${suffix}`, `at://${OTHER_DID}/${EVENT_COLLECTION}/3m3z2a2b3c4d${suffix}`, 'going')));
      }
      return jsonResponse(didDocument(OTHER_DID));
    });
    await expect(request()).resolves.toMatchObject({ complete: false, events: [] });

    installPublicFetch((url) => url.href === didDocumentUrl() ? new Response(' '.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }) : listResponse([]));
    await expect(request()).rejects.toMatchObject({ code: 'response_too_large' });

    vi.useFakeTimers();
    installPublicFetch((url, init) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      return new Promise<Response>(() => {});
    });
    const pendingRead = request();
    const deadlineAssertion = expect(pendingRead).rejects.toMatchObject({ code: 'deadline_exceeded' });
    await vi.advanceTimersByTimeAsync(8_001);
    await deadlineAssertion.finally(() => vi.useRealTimers());
  }, 7_000);

  it('returns hosted events when third-party RSVP targets exceed the lookup budget', async () => {
    const targetDids = Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index));
    installPublicFetch((url) => {
      if (url.href === didDocumentUrl()) return jsonResponse(didDocument());
      if (url.pathname.endsWith('/com.atproto.repo.listRecords')) {
        return url.searchParams.get('collection') === EVENT_COLLECTION
          ? listResponse([eventRecord()])
          : listResponse(targetDids.map((suffix) => rsvpRecord(`3m3z2a2b3c4d${suffix}`, `at://${OTHER_DID}/${EVENT_COLLECTION}/3m3z2a2b3c4d${suffix}`, 'going')));
      }
      return jsonResponse(didDocument(OTHER_DID));
    });

    await expect(request()).resolves.toMatchObject({ complete: false, events: [expect.objectContaining({ attendance: 'hosting' })] });
  });
});
