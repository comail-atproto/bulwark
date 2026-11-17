import { configManager } from '@/lib/admin/config-manager';

type SameSite = 'lax' | 'none' | 'strict';

export function getCookieOptions() {
  const sameSite = configManager.get<SameSite>('cookieSameSite', 'lax');
  const secure = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : (sameSite === 'none' || process.env.NODE_ENV === 'production');
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  };
}

/**
 * Options for a sign-in's cookies: kept for 30 days when remembered, without
 * an expiry otherwise, so the browser drops them when its session ends.
 */
export function getSignInCookieOptions(remember: boolean) {
  const { maxAge, ...sessionOptions } = getCookieOptions();
  return remember ? { ...sessionOptions, maxAge } : sessionOptions;
}
