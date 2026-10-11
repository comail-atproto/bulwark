export type GroupwareFeature = 'calendar' | 'contacts' | 'files';

export function jmapGroupwareFeatures(body: unknown): GroupwareFeature[] | null {
  if (!body || typeof body !== 'object') return null;
  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.using) || !Array.isArray(request.methodCalls)) return null;
  const features = new Set<GroupwareFeature>();
  for (const capability of request.using) {
    if (typeof capability !== 'string') return null;
    if (/:(calendars|calendars:.*)$/.test(capability)) features.add('calendar');
    if (/:(contacts|contacts:.*)$/.test(capability)) features.add('contacts');
    if (/:(filenode|filenode:.*)$/.test(capability)) features.add('files');
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
