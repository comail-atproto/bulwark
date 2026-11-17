import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ACCOUNTS } from '../../tests/helpers/config';

// This loopback fixture is a synthetic Inbox/Space provider. It verifies the
// app's signed assertions, but does not claim to exercise an AT PDS or storage.
export const secret = 'comail-browser-fixture-secret-2026-only';
export const port = Number(process.env.COMAIL_UI_FIXTURE_PORT || 18990);
export const origin = `http://127.0.0.1:${port}`;
const webmail = process.env.IT_WEBMAIL_URL || 'http://127.0.0.1:3000';
const actors = [
  { ...ACCOUNTS.alice, did: 'did:plc:abcdefghijklmnopqrstuvwx', handle: 'alice.example.test' },
  { ...ACCOUNTS.bob, did: 'did:plc:bcdefghijklmnopqrstuvwxy', handle: 'bob.example.test' },
];
type Actor = typeof actors[number];
const contactId = 'urn:uuid:11111111-1111-4111-8111-111111111111';
const fileId = `file-${'a'.repeat(64)}`;
const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const pending = new Map<string, Actor>();
const revoked = new Set<string>();
const consent = new Set<string>();
const shared = new Set<string>();
export const calls: Array<{ mailbox: string; path: string; method: string; body: unknown }> = [];

export function resetFixture(): void { pending.clear(); revoked.clear(); consent.clear(); shared.clear(); calls.length = 0; }
export function withdrawAccess(email: string): void { revoked.add(email); }
export function grantCalendarConsent(email: string): void { consent.add(email); }

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const data = Buffer.concat(chunks).toString('utf8');
  return data ? JSON.parse(data) : {};
}
function assertion(req: IncomingMessage, audience: string): Record<string, unknown> | null {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Record<string, unknown>;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'HS256' || claims.iss !== 'comail-bulwark' || claims.aud !== audience
      || typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.nbf !== 'number' || claims.nbf > now) return null;
    return claims;
  } catch { return null; }
}
function actorFor(claims: Record<string, unknown> | null): Actor | undefined {
  return actors.find(actor => actor.email === claims?.mailbox);
}
function calendar(actor: Actor) {
  return { id: 'cal_overlap', name: `${actor.user} private calendar`, source: 'atproto-space',
    myRole: actor === actors[0] ? 'owner' : 'viewer', initialized: true, revisionId: 'rev-1', policyId: 'policy-1',
    ...(actor === actors[0] ? { offerRole: 'editor' } : {}), mayUpdatePrivate: true,
    members: shared.has(actor.email) ? [{ did: actors[1].did, principalId: actors[1].did, role: 'editor', status: 'active' }] : [] };
}
function event(actor: Actor) {
  return { id: 'event_overlap', uid: 'event_overlap', calendarId: 'cal_overlap', title: `${actor.user} private event`,
    description: '', start: new Date().toISOString().slice(0, 10) + 'T10:00:00', timeZone: 'UTC', duration: 'PT1H',
    showWithoutTime: false, status: 'confirmed', revisionId: 'event-rev-1', actorDID: actor.did, ownerDID: actors[0].did,
    personalRevisionId: `personal-state-${'a'.repeat(64)}`,
    personalProperties: { color: null, freeBusyStatus: 'busy', useDefaultAlerts: false, keywords: null, alerts: null }, recurrenceRules: [{ frequency: 'weekly', interval: 1, count: 12 }] };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', origin);
  if (url.pathname === '/login' && req.method === 'GET') {
    const actor = actors.find(item => item.handle === url.searchParams.get('handle'));
    if (!actor) return json(res, 400, { error: 'unknown_fixture_handle' });
    const code = randomBytes(32).toString('hex'); pending.set(code, actor);
    res.writeHead(302, { Location: `${webmail}/api/auth/relay#code=${code}`, 'Cache-Control': 'no-store' }); res.end(); return;
  }
  if (url.pathname === '/redeem' && req.method === 'POST') {
    const claims = assertion(req, 'comail-relay-sso-redeem');
    const body = await bodyOf(req) as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code : '';
    const actor = pending.get(code);
    if (!actor || claims?.code_hash !== createHash('sha256').update(code).digest('hex')) return json(res, 401, { error: 'unauthorized' });
    pending.delete(code);
    calls.push({ mailbox: actor.email, path: url.pathname, method: 'POST', body: {} });
    return json(res, 200, { did: actor.did, mailbox: actor.email, app_password: actor.password,
      credential_id: `fixture-${actor.user}`, groupware_enabled: true, builders_enabled: false });
  }
  const audience = url.pathname === '/webmail/session' ? 'comail-access-approvals'
    : url.pathname.startsWith('/webmail/calendar/api/v1/') ? 'comail-calendar'
    : url.pathname.startsWith('/webmail/contacts/api/v1/') ? 'comail-contacts'
    : url.pathname.startsWith('/webmail/files/api/v1/') ? 'comail-files'
    : url.pathname.startsWith('/webmail/mail/api/v1/') ? 'comail-mail' : '';
  const claims = assertion(req, audience);
  const actor = actorFor(claims);
  if (!actor || !audience || audience === 'comail-mail' && claims?.sub !== actor.did) return json(res, 401, { error: 'unauthorized' });
  const body = req.method === 'GET' ? {} : await bodyOf(req);
  calls.push({ mailbox: actor.email, path: url.pathname, method: req.method || '', body });
  if (url.pathname === '/webmail/session') return json(res, 200, { did: actor.did, groupware_enabled: !revoked.has(actor.email) });
  if (revoked.has(actor.email)) return json(res, 403, { error: 'forbidden' });
  if (url.pathname.endsWith('/contacts/api/v1/book')) return json(res, 200, { actorDID: actor.did, addressBookId: 'personal', state: 'one', contacts: [
    { id: contactId, card: { '@type': 'Card', version: '1.0', uid: contactId, name: { full: `${actor.user} contact` } } },
  ] });
  if (url.pathname.endsWith('/files/api/v1/inventory')) return json(res, 200, { actorDID: actor.did, files: [{
    $type: 'email.atmos.filePersonal.file', fileId, operationId: `op-${'b'.repeat(64)}`, revisionId: `revision-${'c'.repeat(64)}`,
    name: `${actor.user}.txt`, mimeType: 'text/plain', size: 0, sha256: hash, parents: [], blob: { cid: 'synthetic', mimeType: 'text/plain', size: 0 },
  }] });
  if (url.pathname.endsWith('/calendar/api/v1/sources')) return json(res, 200, { actorDid: actor.did, state: `source-state-${'a'.repeat(64)}`, sources: [{
    id: 'atmo', type: 'atproto-community-calendar', actorDid: actor.did, includeHosted: true, statuses: ['going', 'interested'], enabled: false,
  }] });
  if (url.pathname.endsWith('/calendar/api/v1/calendars')) {
    if (!consent.has(actor.email)) return json(res, 409, { error: 'authorization_required', authorizationProfile: 'member-calendar', calendar: {
      id: 'cal_overlap', name: `${actor.user} private calendar`, source: 'atproto-space', initialized: null,
      pendingConsent: true, revisionId: null, policyId: null, myRole: null,
    } });
    return json(res, 200, { calendars: [calendar(actor)] });
  }
  if (url.pathname.endsWith('/calendar/api/v1/events') && req.method === 'GET') {
    const uri = `at://${actor.did}/community.lexicon.calendar.event/2222222222222`;
    const { recurrenceRules: _recurrenceRules, ...nonrecurringEvent } = event(actor);
    const publicEvent = { ...nonrecurringEvent, id: 'event_public', uid: uri, title: `${actor.user} linked public event`,
      start: new Date().toISOString().slice(0, 10) + 'T14:00:00' };
    return json(res, 200, { events: [event(actor), publicEvent], metadata: {
      event_public: { sequence: 0, publicSource: { uri, cid: `bafyreia${'a'.repeat(50)}a` } },
    } });
  }
  if (url.pathname.endsWith('/calendar/api/v1/events/event_overlap/personal') && req.method === 'PUT') {
    const input = body as { patch?: Record<string, unknown>; basePersonalRevision?: unknown; recurrenceId?: unknown };
    if (input.basePersonalRevision !== `personal-state-${'a'.repeat(64)}` || typeof input.recurrenceId !== 'string' || !input.patch
      || Object.keys(input.patch).some(key => !['alerts', 'keywords', 'color', 'freeBusyStatus', 'useDefaultAlerts'].includes(key))) {
      return json(res, 400, { error: 'invalid_request' });
    }
    return json(res, 200, { ...event(actor), personalProperties: { ...event(actor).personalProperties, ...input.patch } });
  }
  if (url.pathname.endsWith('/calendar/api/v1/events/event_public/personal') && req.method === 'PUT') {
    const input = body as { patch?: Record<string, unknown>; basePersonalRevision?: unknown; recurrenceId?: unknown };
    if (input.basePersonalRevision !== `personal-state-${'a'.repeat(64)}` || !input.patch
      || Object.keys(input.patch).some(key => !['alerts', 'keywords', 'color', 'freeBusyStatus', 'useDefaultAlerts'].includes(key))) {
      return json(res, 400, { error: 'invalid_request' });
    }
    const { recurrenceRules: _recurrenceRules, ...nonrecurringEvent } = event(actor);
    return json(res, 200, { ...nonrecurringEvent, id: 'event_public', uid: `at://${actor.did}/community.lexicon.calendar.event/2222222222222`,
      title: `${actor.user} linked public event`, personalProperties: { ...event(actor).personalProperties, ...input.patch } });
  }
  if (url.pathname.endsWith('/calendar/api/v1/principals')) return json(res, 200, { principals: [{
    id: actors[1].did, type: 'individual', name: 'Fixture invitee', email: actors[1].email,
  }] });
  if (url.pathname.endsWith('/calendar/api/v1/share') && req.method === 'POST') {
    const input = body as { principalId?: unknown; role?: unknown };
    if (input.principalId !== actors[1].did || input.role !== 'editor') return json(res, 400, { error: 'invalid_request' });
    shared.add(actor.email);
    return json(res, 200, { status: 'shared' });
  }
  if (url.pathname.endsWith('/mail/api/v1/messages/read')) return json(res, 404, { error: 'not_found' });
  if (url.pathname.endsWith('/calendar/api/v1/member/consent/start')) return json(res, 202, {
    status: 'authorization_required', authorizationUrl: `https://fixture.invalid/oauth/calendar/tickets/${'A'.repeat(43)}`,
  });
  return json(res, 404, { error: 'not_found' });
}

export async function startFixture(): Promise<Server> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port');
  const server = createServer((req, res) => { void handle(req, res).catch(() => json(res, 500, { error: 'fixture_error' })); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
