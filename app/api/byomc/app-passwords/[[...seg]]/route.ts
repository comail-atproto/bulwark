import { bridgeFailureClass } from '@/lib/auth/inbox-config';
// Named app-password management reaches Inbox only through the private
// backchannel; the mailbox comes from the caller's encrypted Bulwark session.

import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/admin/session';
import { logger } from '@/lib/logger';
import { signBridgeToken, sessionMailbox, relayBridgeUrl } from '@/lib/byomc/relay-bridge';

export const dynamic = 'force-dynamic';

type SegParams = { params: Promise<{ seg?: string[] }> };

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// The backchannel refuses redirects and never caches returned credentials.
async function callInbox(
  req: NextRequest,
  method: 'GET' | 'POST' | 'DELETE',
  suffix: string,
  body?: string,
): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) {
    return json(403, { error: 'forbidden' });
  }
  const base = relayBridgeUrl();
  if (!base) {
    return json(503, { error: 'app-password bridge not configured' });
  }
  const mailbox = await sessionMailbox();
  if (!mailbox) {
    return json(401, { error: 'not authenticated' });
  }
  const token = signBridgeToken(mailbox);
  if (!token) {
    return json(503, { error: 'app-password bridge not configured' });
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base}${suffix}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    text = await res.text();
  } catch (err) {
    logger.error('BYOMC bridge request failed', { outcome: bridgeFailureClass(err) });
    return json(502, { error: 'app-password service unreachable' });
  }

  return new NextResponse(text.length > 0 ? text : null, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  const { seg } = await params;
  if (seg && seg.length > 0) return json(404, { error: 'not found' }); // no per-id GET
  return callInbox(req, 'GET', '');
}

export async function POST(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  const { seg } = await params;
  if (seg && seg.length > 0) return json(404, { error: 'not found' });
  const body = await req.text();
  return callInbox(req, 'POST', '', body || '{}');
}

export async function DELETE(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  const { seg } = await params;
  const id = seg?.[0];
  if (!id) return json(404, { error: 'not found' });
  return callInbox(req, 'DELETE', `/${encodeURIComponent(id)}`);
}
