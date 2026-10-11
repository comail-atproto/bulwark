import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { enableWebPush } from '@/lib/web-push';

const vapidPublicKey = 'B'.repeat(87);

describe('enableWebPush verification retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    } satisfies Storage);

    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn(async () => 'granted'),
    });
    vi.stubGlobal('PushManager', class PushManager {});

    const pushSubscription = {
      endpoint: 'https://push.example/subscription',
      options: { applicationServerKey: null },
      getKey: vi.fn(() => new Uint8Array([1, 2, 3]).buffer),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => pushSubscription),
      },
    } as unknown as ServiceWorkerRegistration;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => registration),
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('recreates one unverified JMAP subscription after the throttle window', async () => {
    let createCount = 0;
    const createPushSubscription = vi.fn(async () => {
      createCount += 1;
      return `server-${createCount}`;
    });
    const destroyPushSubscription = vi.fn(async () => undefined);
    const verifyPushSubscription = vi.fn(async () => undefined);
    const client = {
      getAccountId: () => 'account-1',
      listPushSubscriptions: vi.fn(async () => []),
      createPushSubscription,
      destroyPushSubscription,
      verifyPushSubscription,
    } as unknown as IJMAPClient;

    const registerRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/push/vapid-public-key')) {
        return new Response(JSON.stringify({ publicKey: vapidPublicKey }), { status: 200 });
      }
      if (url.endsWith('/api/push/register/web')) {
        registerRequests.push(String(init?.body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/push/verify/')) {
        return new Response(JSON.stringify({
          verificationCode: createCount >= 2 ? 'retry-code' : null,
        }), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    }));

    const enabling = enableWebPush({
      client,
      relayBaseUrl: 'https://relay.example',
      accountLabel: 'owner@example.com',
      inboxOnly: false,
    });
    await vi.advanceTimersByTimeAsync(76_000);

    await expect(enabling).resolves.toEqual({ subscriptionId: 'server-2' });
    expect(createPushSubscription).toHaveBeenCalledTimes(2);
    expect(destroyPushSubscription).toHaveBeenCalledWith('server-1');
    expect(verifyPushSubscription).toHaveBeenCalledWith('server-2', 'retry-code');
    expect(registerRequests).toHaveLength(2);
  });
});
