import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings-store';

describe('settings-store attachment action', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  it('defaults to preview when settings are reset', () => {
    expect(useSettingsStore.getState().mailAttachmentAction).toBe('preview');
  });

  it('includes the attachment action in exported settings', () => {
    useSettingsStore.getState().updateSetting('mailAttachmentAction', 'download');

    const exported = JSON.parse(useSettingsStore.getState().exportSettings()) as {
      mailAttachmentAction?: string;
    };

    expect(exported.mailAttachmentAction).toBe('download');
  });

  it('includes calendar invitation parsing in exported settings', () => {
    useSettingsStore.getState().updateSetting('calendarInvitationParsingEnabled', false);

    const exported = JSON.parse(useSettingsStore.getState().exportSettings()) as {
      calendarInvitationParsingEnabled?: boolean;
    };

    expect(exported.calendarInvitationParsingEnabled).toBe(false);
  });

  it('includes reply identity auto-selection in exported settings', () => {
    useSettingsStore.getState().updateSetting('autoSelectReplyIdentity', true);

    const exported = JSON.parse(useSettingsStore.getState().exportSettings()) as {
      autoSelectReplyIdentity?: boolean;
    };

    expect(exported.autoSelectReplyIdentity).toBe(true);
  });
});