import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('access-approval service-worker notification', () => {
  it('uses Cammie and silently replaces a duplicate wake-up', async () => {
    const source = await readFile(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
    const accessApprovalBlock = source.match(
      /if \(payload && payload\.kind === "access-approval"\) \{([\s\S]*?)\n[ ]{2}\}/,
    )?.[1];

    expect(accessApprovalBlock).toBeDefined();
    expect(accessApprovalBlock).toContain('icon: `${BASE_PATH}/branding/comail/cammie-mark.png`');
    expect(accessApprovalBlock).toContain('badge: `${BASE_PATH}/branding/comail/cammie-mark.png`');
    expect(accessApprovalBlock).toContain('tag: "comail-access-approval"');
    expect(accessApprovalBlock).toContain('renotify: false');
    expect(accessApprovalBlock).not.toContain('/api/pwa-icon/192');
  });

  it('marks a click without exposing request details', async () => {
    const source = await readFile(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
    expect(source).toContain('return `${BASE_PATH}/?approvalWake=1`;');
  });
});
