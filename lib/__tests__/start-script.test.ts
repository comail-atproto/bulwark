// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { startArgs } from '../../scripts/start.mjs';

const files = (...envs: Array<Record<string, string>>) => envs.map((env) => ({ env }));

// #1441: `next start` ignores HOSTNAME and PORT in .env.local, so npm start
// passes them as flags.
describe('npm start arguments', () => {
  it('listens on the HOSTNAME and PORT from .env.local', () => {
    expect(startArgs({}, files({ HOSTNAME: '127.0.0.1', PORT: '3005' }), 'mail')).toEqual(['start', '-H', '127.0.0.1', '-p', '3005']);
  });

  it('passes no flags when nothing is set, so Next keeps its defaults', () => {
    expect(startArgs({}, files({}), 'mail')).toEqual(['start']);
  });

  it('prefers the shell over the files, and the first file over later ones', () => {
    expect(startArgs({ HOSTNAME: '::1', PORT: '4000' }, files({ HOSTNAME: '127.0.0.1', PORT: '3005' }), 'mail')).toEqual(['start', '-H', '::1', '-p', '4000']);
    expect(startArgs({}, files({ HOSTNAME: '127.0.0.1' }, { HOSTNAME: '0.0.0.0', PORT: '3001' }), 'mail')).toEqual(['start', '-H', '127.0.0.1', '-p', '3001']);
  });

  it('ignores a shell HOSTNAME that is just the machine name', () => {
    expect(startArgs({ HOSTNAME: 'mail' }, files({ HOSTNAME: '127.0.0.1' }), 'mail')).toEqual(['start', '-H', '127.0.0.1']);
    expect(startArgs({ HOSTNAME: 'mail' }, files({}), 'mail')).toEqual(['start']);
  });

  it('puts options given to npm start last so they win', () => {
    expect(startArgs({}, files({ HOSTNAME: '127.0.0.1' }), 'mail', ['-H', '0.0.0.0'])).toEqual(['start', '-H', '127.0.0.1', '-H', '0.0.0.0']);
  });
});
