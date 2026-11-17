export interface AtmoSourceCatalog {
  actorDid: string;
  state: string;
  sources: [{
    id: 'atmo';
    type: 'atproto-community-calendar';
    actorDid: string;
    includeHosted: true;
    statuses: ['going', 'interested'];
    enabled: boolean;
  }];
}

export function isAtmoSourceCatalog(value: unknown, actorDid?: string): value is AtmoSourceCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const catalog = value as Record<string, unknown>;
  if (typeof catalog.actorDid !== 'string' || !/^did:(plc|web):[^\s]+$/.test(catalog.actorDid)
    || actorDid !== undefined && catalog.actorDid !== actorDid
    || typeof catalog.state !== 'string' || !/^source-state-[a-f0-9]{64}$/.test(catalog.state)
    || !Array.isArray(catalog.sources) || catalog.sources.length !== 1
    || Object.keys(catalog).some(key => !['actorDid', 'state', 'sources'].includes(key))) return false;
  const source = catalog.sources[0];
  return !!source && typeof source === 'object' && !Array.isArray(source)
    && source.id === 'atmo' && source.type === 'atproto-community-calendar'
    && source.actorDid === catalog.actorDid && source.includeHosted === true
    && typeof source.enabled === 'boolean' && Array.isArray(source.statuses)
    && source.statuses.length === 2 && source.statuses[0] === 'going' && source.statuses[1] === 'interested'
    && Object.keys(source).every(key => ['id', 'type', 'actorDid', 'includeHosted', 'statuses', 'enabled'].includes(key));
}
