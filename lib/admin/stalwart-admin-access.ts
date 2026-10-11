import { configManager } from './config-manager';
import { logger } from '@/lib/logger';

/**
 * How a Stalwart admin account maps onto the Bulwark admin dashboard (#870).
 *
 *   auto     - Stalwart admins get the shield and are signed into /admin
 *              without the Bulwark admin password (the original behaviour).
 *   password - Stalwart admins still get the shield, but /admin asks for
 *              the Bulwark admin password.
 *   off      - Stalwart admin status is ignored entirely: no shield, and
 *              only the Bulwark admin password opens /admin.
 */
export type StalwartAdminAccessMode = 'auto' | 'password' | 'off';

export const STALWART_ADMIN_ACCESS_MODES: readonly StalwartAdminAccessMode[] = ['auto', 'password', 'off'];

export function isStalwartAdminAccessMode(value: unknown): value is StalwartAdminAccessMode {
  return typeof value === 'string' && (STALWART_ADMIN_ACCESS_MODES as readonly string[]).includes(value);
}

/**
 * Read the configured mode. Anything unrecognised (a typo in the env var,
 * a hand-edited config.json) fails closed to `off`: the dashboard stays
 * reachable through the password login, and nobody is granted admin on
 * the strength of a value we can't interpret.
 */
export async function getStalwartAdminAccessMode(): Promise<StalwartAdminAccessMode> {
  await configManager.ensureLoaded();
  const raw = configManager.get<unknown>('stalwartAdminAccess', 'auto');
  if (isStalwartAdminAccessMode(raw)) return raw;
  logger.warn('Unrecognised stalwartAdminAccess value; treating as "off"', { value: raw });
  return 'off';
}
