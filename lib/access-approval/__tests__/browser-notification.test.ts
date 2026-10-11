import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAccessApprovalNotification, showAccessApprovalNotification } from '../browser-notification';

const showNotification = vi.fn();
const requestPermission = vi.fn();
const close = vi.fn();
const getNotifications = vi.fn();

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

describe('showAccessApprovalNotification', () => {
  beforeEach(() => {
    showNotification.mockReset().mockResolvedValue(undefined);
    requestPermission.mockReset();
    close.mockReset();
    getNotifications.mockReset().mockResolvedValue([{ close }]);
    setVisibility('hidden');
    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification, getNotifications }) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setVisibility('visible');
  });

  it('shows a generic wake-up notification with no request details', async () => {
    const shown = await showAccessApprovalNotification({
      id: 17,
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    });

    expect(shown).toBe(true);
    expect(showNotification).toHaveBeenCalledWith('New Atmosphere login', {
      body: 'Open comail Inbox to review this sign-in request.',
      tag: 'comail-access-approval',
      icon: '/branding/comail/cammie-mark.png',
      badge: '/branding/comail/cammie-mark.png',
      data: { kind: 'access-approval' },
    });
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain('17');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('stays silent while Inbox is visible', async () => {
    setVisibility('visible');

    expect(
      await showAccessApprovalNotification({
        id: 17,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      }),
    ).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('never prompts when permission has not already been granted', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission,
    });

    expect(
      await showAccessApprovalNotification({
        id: 17,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      }),
    ).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('closes the tagged wake-up after the request settles', async () => {
    await dismissAccessApprovalNotification();

    expect(getNotifications).toHaveBeenCalledWith({
      tag: 'comail-access-approval',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
