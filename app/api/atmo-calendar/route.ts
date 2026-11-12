import { NextRequest, NextResponse } from 'next/server';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { rejectCrossOriginRequest } from '@/lib/security/same-origin';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { groupwareActor } from '@/lib/groupware/access';
import { readPublicAtmoCalendar, validatePublicAtmoCalendarWindow } from '@/lib/atmo-calendar/public-reader';
import { readAtmoSourcePreferences } from '@/lib/atmo-calendar/source-preferences';
import { isAtmoSourceCatalog, type AtmoSourceCatalog } from '@/lib/atmo-calendar/source';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  const denied = rejectCrossOriginRequest(request);
  if (denied) return denied;
  const query = request.nextUrl.searchParams;
  if ([...query.keys()].some(key => !['slot', 'after', 'before', 'local', 'enabled'].includes(key) || query.getAll(key).length !== 1)) {
    return reply({ error: 'invalid_request' }, 400);
  }
  const local = query.get('local');
  const enabled = query.get('enabled');
  if (local !== null && local !== '1' || enabled !== null && (local !== '1' || !['true', 'false'].includes(enabled))) {
    return reply({ error: 'invalid_request' }, 400);
  }
  const rawSlot = query.get('slot');
  if (rawSlot !== null && (!/^\d+$/.test(rawSlot) || Number(rawSlot) >= MAX_ACCOUNT_SLOTS)) return reply({ error: 'invalid_request' }, 400);
  const after = query.get('after');
  const before = query.get('before');
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (after !== null || before !== null) {
    const range = Date.parse(before ?? '') - Date.parse(after ?? '');
    if (!after || !before || !timestamp.test(after) || !timestamp.test(before)
      || !Number.isFinite(range) || range <= 0 || range > 366 * 86400_000) return reply({ error: 'invalid_request' }, 400);
  }
  if (after && before) {
    try { validatePublicAtmoCalendarWindow(after, before); } catch { return reply({ error: 'invalid_request' }, 400); }
  }
  const credentials = await getStalwartCredentials(request);
  if (!credentials) return reply({ error: 'unauthorized' }, 401);
  // An explicit slot may never fall back to another account's cookie.
  if (rawSlot !== null && credentials.slot !== Number(rawSlot)) return reply({ error: 'unauthorized' }, 401);
  const actorDid = await groupwareActor(request, credentials, 'calendar');
  if (!actorDid) return reply({ error: 'not_found' }, 404);
  try {
    let catalog: AtmoSourceCatalog | null = null;
    try {
      catalog = await readAtmoSourcePreferences(credentials.username, actorDid);
      if (!isAtmoSourceCatalog(catalog, actorDid)) return reply({ error: 'provider_unavailable' }, 502);
    } catch (error) {
      const failure = error as { code?: unknown; status?: unknown; authorizationProfile?: unknown };
      const unavailable = failure.code === 'not_found' && failure.status === 404
        || failure.code === 'authorization_required' && failure.status === 409
          && (failure.authorizationProfile === 'owner-source' || failure.authorizationProfile === 'member-source');
      // Browser inclusion authorizes only public reads. Provider faults cannot
      // replace an existing PDS preference with a local one.
      if (local !== '1' || !unavailable) throw error;
    }
    if (!after || !before) return reply(catalog ?? { actorDid, preferenceStorage: 'browser' });
    if (!(catalog ? catalog.sources[0].enabled : enabled === 'true')) return reply({ actorDid, after, before, events: [], complete: true });
    return reply(await readPublicAtmoCalendar({ actorDid, after, before }));
  } catch (error) {
    const failure = error as { code?: unknown; status?: unknown; authorizationProfile?: unknown };
    if (failure.code === 'authorization_required' && failure.status === 409
      && (failure.authorizationProfile === 'owner-source' || failure.authorizationProfile === 'member-source')) {
      return reply({ error: 'authorization_required', authorizationProfile: failure.authorizationProfile, actorDid }, 409);
    }
    if (failure.code === 'not_found' && failure.status === 404) return reply({ error: 'not_found' }, 404);
    return reply({ error: 'provider_unavailable' }, 502);
  }
}
