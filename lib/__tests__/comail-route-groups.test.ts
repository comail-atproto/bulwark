import { describe, expect, it } from 'vitest';
import { routeGroup, scrubRoutePath } from '@/lib/route-groups';

describe('Comail route labels', () => {
  it.each(['atmo-calendar', 'builders-membership', 'byomc', 'calendar', 'contacts', 'files'])(
    'groups %s requests without including private path or query values', (group) => {
      const path = `/webmail/api/${group}/private-record?private=value`;
      expect(routeGroup(path, '/webmail')).toBe(`api:${group}`);
      expect(scrubRoutePath(path, '/webmail')).toBe(`/api/${group}/…`);
    },
  );
});
