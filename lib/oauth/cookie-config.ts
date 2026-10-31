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
