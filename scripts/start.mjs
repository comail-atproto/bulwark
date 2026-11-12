// npm start: runs `next start` on the HOSTNAME and PORT from the environment
// or the .env files.
//
// `next start` takes its listen address only from -H and its port only from
// -p or a PORT set in the shell, so the HOSTNAME and PORT that setup.sh
// writes to .env.local did nothing: the server always listened on every
// interface, port 3000 (#1441). Docker and the standalone tarballs run
// server.js, which reads both from the environment, and are not affected.
//
//   node scripts/start.mjs [next start options]   (npm start [-- options])

import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `next start` arguments for a server that listens where the environment
 * says. A variable set in the shell wins over the .env files, as everywhere
 * else in Next. Some distributions' shell profiles export HOSTNAME as the
 * machine's name, which is not a listen address, so a HOSTNAME equal to the
 * machine name is left to the .env files. Options passed to npm start come
 * last and win.
 *
 * @param {Record<string, string | undefined>} shellEnv the environment before the .env files were loaded
 * @param {Array<{ env: Record<string, string | undefined> }>} envFiles the loaded .env files, highest precedence first
 * @param {string} machineName
 * @param {string[]} [extraArgs]
 */
export function startArgs(shellEnv, envFiles, machineName, extraArgs = []) {
  const fromFiles = (key) => envFiles.find((file) => file.env[key])?.env[key];
  const shellHost = shellEnv.HOSTNAME && shellEnv.HOSTNAME !== machineName ? shellEnv.HOSTNAME : undefined;
  const host = shellHost || fromFiles('HOSTNAME');
  const port = shellEnv.PORT || fromFiles('PORT');
  return ['start', ...(host ? ['-H', host] : []), ...(port ? ['-p', port] : []), ...extraArgs];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve('next/dist/bin/next');
  // Next's own copy, so the files are loaded once and Next reuses the result.
  const { loadEnvConfig } = createRequire(nextBin)('@next/env');
  const shellEnv = { ...process.env };
  const { loadedEnvFiles } = loadEnvConfig(process.cwd(), false);
  process.argv = [process.argv[0], nextBin, ...startArgs(shellEnv, loadedEnvFiles, hostname(), process.argv.slice(2))];
  require(nextBin);
}
