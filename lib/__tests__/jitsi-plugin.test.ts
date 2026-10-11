import { describe, it, expect } from 'vitest';
// ─── Inline copies of the plugin helpers (pure functions, no deps) ──────────

// These mirror the implementations in repos/plugins/jitsi-meet/src/index.js
// so we can unit-test them without esbuild bundling.

function generateRoomName(eventTitle: string): string {
  const slug = eventTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  const suffix = crypto.randomUUID().slice(0, 8);
  return slug ? `${slug}-${suffix}` : suffix;
}

function buildMeetingUrl(jitsiUrl: string, roomName: string): string {
  const base = jitsiUrl.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(roomName)}`;
}

function base64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createJitsiJwt(options: {
  secret: string;
  roomName: string;
  userEmail?: string;
  userName?: string;
  jitsiUrl: string;
}): Promise<string> {
  const { secret, roomName, userEmail, userName, jitsiUrl } = options;

  let domain: string;
  try {
    domain = new URL(jitsiUrl).hostname;
  } catch {
    domain = jitsiUrl;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: Record<string, unknown> = {
    iss: 'bulwark-webmail',
    sub: domain,
    aud: 'jitsi',
    room: roomName,
    iat: now,
    exp: now + 86400,
    context: {
      user: {
        ...(userName ? { name: userName } : {}),
        ...(userEmail ? { email: userEmail } : {}),
      },
    },
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const signatureB64 = base64url(signature);

  return `${signingInput}.${signatureB64}`;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('generateRoomName', () => {
  it('should slugify the event title and append a random suffix', () => {
    const room = generateRoomName('Team Standup');
    expect(room).toMatch(/^team-standup-[a-f0-9]{8}$/);
  });

  it('should handle special characters', () => {
    const room = generateRoomName('Q&A Session: "Ask Me Anything!"');
    expect(room).toMatch(/^q-a-session-ask-me-anything-[a-f0-9]{8}$/);
  });

  it('should handle empty title', () => {
    const room = generateRoomName('');
    expect(room).toMatch(/^[a-f0-9]{8}$/);
  });

  it('should handle whitespace-only title', () => {
    const room = generateRoomName('   ');
    expect(room).toMatch(/^[a-f0-9]{8}$/);
  });

  it('should truncate long titles to 60 chars plus suffix', () => {
    const longTitle = 'A'.repeat(100);
    const room = generateRoomName(longTitle);
    // 60 chars of slug + '-' + 8 char suffix = 69 max
    expect(room.length).toBeLessThanOrEqual(69);
  });

  it('should generate unique room names for the same title', () => {
    const room1 = generateRoomName('Standup');
    const room2 = generateRoomName('Standup');
    expect(room1).not.toBe(room2);
  });
});

describe('buildMeetingUrl', () => {
  it('should combine base URL and room name', () => {
    const url = buildMeetingUrl('https://meet.example.com', 'my-room-abc12345');
    expect(url).toBe('https://meet.example.com/my-room-abc12345');
  });

  it('should strip trailing slashes from base URL', () => {
    const url = buildMeetingUrl('https://meet.example.com/', 'room');
    expect(url).toBe('https://meet.example.com/room');
  });

  it('should strip multiple trailing slashes', () => {
    const url = buildMeetingUrl('https://meet.example.com///', 'room');
    expect(url).toBe('https://meet.example.com/room');
  });

  it('should URL-encode the room name', () => {
    const url = buildMeetingUrl('https://meet.example.com', 'room with spaces');
    expect(url).toBe('https://meet.example.com/room%20with%20spaces');
  });
});

describe('createJitsiJwt', () => {
  it('should create a valid HS256 JWT', async () => {
    const token = await createJitsiJwt({
      secret: 'test-secret-key',
      roomName: 'test-room',
      userEmail: 'user@example.com',
      userName: 'Test User',
      jitsiUrl: 'https://meet.example.com',
    });

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(payload.iss).toBe('bulwark-webmail');
    expect(payload.sub).toBe('meet.example.com');
    expect(payload.aud).toBe('jitsi');
    expect(payload.room).toBe('test-room');
    expect(payload.context.user.name).toBe('Test User');
    expect(payload.context.user.email).toBe('user@example.com');
    expect(payload.exp).toBe(payload.iat + 86400);
  });

  it('should set the sub claim to the Jitsi hostname', async () => {
    const token = await createJitsiJwt({
      secret: 'secret',
      roomName: 'room',
      jitsiUrl: 'https://jitsi.corp.example.com/subfolder',
    });

    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(payload.sub).toBe('jitsi.corp.example.com');
  });

  it('should omit undefined user fields', async () => {
    const token = await createJitsiJwt({
      secret: 'secret',
      roomName: 'room',
      jitsiUrl: 'https://meet.example.com',
    });

    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(payload.context.user.name).toBeUndefined();
    expect(payload.context.user.email).toBeUndefined();
  });

  it('should produce a different signature with different secrets', async () => {
    const token1 = await createJitsiJwt({
      secret: 'secret-one',
      roomName: 'room',
      jitsiUrl: 'https://meet.example.com',
    });
    const token2 = await createJitsiJwt({
      secret: 'secret-two',
      roomName: 'room',
      jitsiUrl: 'https://meet.example.com',
    });

    expect(token1.split('.')[2]).not.toBe(token2.split('.')[2]);
  });

  it('should produce a verifiable HMAC-SHA256 signature', async () => {
    const secret = 'my-test-secret';
    const token = await createJitsiJwt({
      secret,
      roomName: 'verify-room',
      jitsiUrl: 'https://meet.example.com',
    });

    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const signingInput = `${headerB64}.${payloadB64}`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sigPadded = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    const sigBinary = atob(sigPadded);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput));
    expect(valid).toBe(true);
  });
});
