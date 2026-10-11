import { configManager } from '@/lib/admin/config-manager';
import { readFileEnv } from '@/lib/read-file-env';

/**
 * Resolve the session secret from any of the supported sources, in priority
 * order:
 *   1. SESSION_SECRET env var
 *   2. SESSION_SECRET_FILE-pointed file
 *   3. Admin override in config.json (set by the setup wizard)
 *
 * Returns an empty string when nothing is configured. Callers must treat
 * empty as "feature disabled" rather than crashing.
 *
 * The configManager fallback exists so the web installer can persist the
 * secret without touching .env files. It only takes effect if the env vars
 * aren't set, so existing deployments aren't affected.
 */
export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;

  const fromFile = readFileEnv(process.env.SESSION_SECRET_FILE);
  if (fromFile) return fromFile;

  const fromAdmin = configManager.get<string>('sessionSecret', '');
  if (fromAdmin) return fromAdmin;

  const fromAdminFile = readFileEnv(
    configManager.get<string>('sessionSecretFile', ''),
  );
  return fromAdminFile || "";
}

export function hasSessionSecret(): boolean {
  return getSessionSecret().length > 0;
}
