import { describe, it, expect } from 'vitest';
import { useSettingsStore, migrateSettings } from '../settings-store';

describe('reduce motion setting (#1215)', () => {
  it('marks the page so the stylesheet can stop every animation, and unmarks it again', () => {
    useSettingsStore.getState().updateSetting('reduceMotion', 'on');
    expect(document.documentElement.dataset.motion).toBe('reduce');
    expect(document.documentElement.dataset.animations).toBe('off');

    useSettingsStore.getState().updateSetting('reduceMotion', 'system');
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(document.documentElement.dataset.animations).toBeUndefined();

    useSettingsStore.getState().updateSetting('reduceMotion', 'off');
    expect(document.documentElement.dataset.motion).toBe('full');
  });

  it('carries the old Animations switch over to Reduce motion', () => {
    const off = migrateSettings({ animationsEnabled: false, explicitSettings: ['animationsEnabled'] }, 8) as unknown as Record<string, unknown>;
    expect(off.reduceMotion).toBe('on');
    expect(off.animationsEnabled).toBeUndefined();
    expect(off.explicitSettings).toEqual(['reduceMotion']);

    const on = migrateSettings({ animationsEnabled: true, explicitSettings: [] }, 8) as unknown as Record<string, unknown>;
    expect(on.reduceMotion).toBe('system');
  });

  it('reads the old switch from a settings file exported by an older build', () => {
    useSettingsStore.getState().updateSetting('reduceMotion', 'system');
    expect(useSettingsStore.getState().importSettings(JSON.stringify({ animationsEnabled: false }))).toBe(true);
    expect(useSettingsStore.getState().reduceMotion).toBe('on');
  });
});
