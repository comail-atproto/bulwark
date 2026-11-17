import { calendarBridgeEndpoint } from '@/lib/auth/inbox-config';
import { signCalendarBridgeToken } from '@/lib/space-calendar/bridge';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { isAtmoSourceCatalog, type AtmoSourceCatalog } from './source';

export class AtmoSourceError extends Error {
  constructor(readonly code: string, readonly status: number, readonly authorizationProfile?: 'owner-source' | 'member-source') {
    super(code);
    this.name = 'AtmoSourceError';
  }
}

export async function readAtmoSourcePreferences(mailbox: string, actorDid: string): Promise<AtmoSourceCatalog> {
  const base = calendarBridgeEndpoint();
  const token = signCalendarBridgeToken(mailbox);
  if (!base || !token) throw new AtmoSourceError('not_found', 404);
  try {
    const response = await fetch(`${base}/sources`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new AtmoSourceError('provider_unavailable', 502);
    }
    const body: unknown = JSON.parse(await readBoundedUtf8Body(response.body, 4096));
    if (!response.ok) {
      const error = body as { error?: unknown; authorizationProfile?: unknown } | null;
      if (response.status === 409 && error?.error === 'authorization_required'
        && (error.authorizationProfile === 'owner-source' || error.authorizationProfile === 'member-source')) {
        throw new AtmoSourceError('authorization_required', 409, error.authorizationProfile);
      }
      throw new AtmoSourceError(response.status === 404 ? 'not_found' : 'provider_unavailable', response.status === 404 ? 404 : 502);
    }
    if (!isAtmoSourceCatalog(body, actorDid)) throw new AtmoSourceError('provider_unavailable', 502);
    return body;
  } catch (error) {
    if (error instanceof AtmoSourceError) throw error;
    throw new AtmoSourceError('provider_unavailable', 502);
  }
}
