export type GroupwareFeature = 'calendar' | 'contacts' | 'files';

export function jmapGroupwareFeatures(body: unknown): GroupwareFeature[] | null {
  if (!body || typeof body !== 'object') return null;
  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.using) || !Array.isArray(request.methodCalls)) return null;
  const features = new Set<GroupwareFeature>();
  for (const capability of request.using) {
    if (typeof capability !== 'string' || /\s/.test(capability)) return null;
    const parts = capability.split(':').slice(1);
    if (parts.includes('calendars')) features.add('calendar');
    if (parts.includes('contacts')) features.add('contacts');
    if (parts.includes('filenode')) features.add('files');
  }
  for (const call of request.methodCalls) {
    if (!Array.isArray(call) || typeof call[0] !== 'string') return null;
    const object = call[0].split('/')[0];
    if (object.startsWith('Calendar') || ['Task', 'TaskList'].includes(object) || call[0] === 'Principal/getAvailability') features.add('calendar');
    if (object.startsWith('AddressBook') || object.startsWith('Contact')) features.add('contacts');
    if (object.startsWith('FileNode')) features.add('files');
  }
  return [...features];
}
