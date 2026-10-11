import { bridgeFailureClass } from '@/lib/auth/inbox-config';
// Same-origin Inbox surface for active-laptop atproto login approval.
// Identity comes from the encrypted Bulwark session, never browser input.

import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/admin/session';
import {
  accessApprovalRelayBridgeUrl,
  accessApprovalSessionMailbox,
  signAccessApprovalBridgeToken,
} from '@/lib/access-approval/relay-bridge';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type SegParams = { params: Promise<{ seg?: string[] }> };

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function callInbox(
  req: NextRequest,
  method: 'GET' | 'POST' | 'DELETE',
  suffix: string,
  body?: string,
): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) return json(403, { error: 'forbidden' });
  const base = accessApprovalRelayBridgeUrl();
  if (!base) return json(503, { error: 'access approval bridge not configured' });
  const mailbox = await accessApprovalSessionMailbox();
  if (!mailbox) return json(401, { error: 'not authenticated' });
  const token = signAccessApprovalBridgeToken(mailbox);
  if (!token) return json(503, { error: 'access approval bridge not configured' });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${base}${suffix}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    text = await response.text();
  } catch (error) {
    logger.error('Access approval bridge request failed', {
      outcome: bridgeFailureClass(error),
    });
    return json(502, { error: 'access approval service unreachable' });
  }
  return new NextResponse(text || null, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  const { seg } = await params;
  if (seg && seg.length > 0) return json(404, { error: 'not found' });
  return callInbox(req, 'GET', '');
}

export async function POST(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  const { seg } = await params;
  if (seg?.length === 1 && seg[0] === 'push-subscriptions') {
    const body = await req.text();
    return callInbox(req, 'POST', '/push-subscriptions', body || '{}');
  }
  if (!seg || seg.length !== 2 || seg[1] !== 'decision' || !/^\d+$/.test(seg[0])) {
    return json(404, { error: 'not found' });
  }
  const body = await req.text();
  return callInbox(req, 'POST', `/${encodeURIComponent(seg[0])}/decision`, body || '{}');
}

export async function DELETE(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  const { seg } = await params;
  if (!seg || seg.length !== 2 || seg[0] !== 'push-subscriptions') {
    return json(404, { error: 'not found' });
  }
  return callInbox(req, 'DELETE', `/push-subscriptions/${encodeURIComponent(seg[1])}`);
}
