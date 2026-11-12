"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Accessibility } from '@/components/icons';
import { RadioGroup, Select, SettingItem, ToggleSwitch } from '@/components/settings/settings-section';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { FONT_SIZES, type FontSize } from '@/lib/accessibility-settings';
import { useRegisterCommands } from '@/lib/command-registry';
import { ACCESSIBILITY_PRESET_IDS, presetChanges, type AccessibilityPresetId, type PresetChange } from '@/lib/accessibility-presets';

export const ACCESSIBILITY_PANEL_EVENT = 'bulwark:accessibility-panel';

/** Opens the quick accessibility panel from anywhere (rail button, palette). */
export function openAccessibilityPanel(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCESSIBILITY_PANEL_EVENT));
}

/**
 * Alt+Shift+A, by physical key so it works on every keyboard layout. A
 * modifier shortcut, so it stays on when single-key shortcuts are off.
 */
export function isAccessibilityPanelShortcut(event: KeyboardEvent): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyA';
}

type SettingKey = Parameters<ReturnType<typeof useSettingsStore.getState>['updateSetting']>[0];

function QuickPanel({ isOpen, onClose, signedIn }: { isOpen: boolean; onClose: () => void; signedIn: boolean }) {
  const t = useTranslations('accessibility_panel');
  const tA = useTranslations('settings.accessibility');
  const settings = useSettingsStore();
  const { isSettingLocked } = usePolicyStore();
  const [applied, setApplied] = useState<{ id: AccessibilityPresetId; changes: PresetChange[] } | null>(null);
  const set = (key: string, value: unknown) => settings.updateSetting(key as SettingKey, value as never);

  const applyPreset = (id: AccessibilityPresetId) => {
    const changes = presetChanges(id, useSettingsStore.getState() as unknown as Record<string, unknown>, isSettingLocked);
    for (const change of changes) set(change.key, change.to);
    setApplied({ id, changes });
  };

  const router = useRouter();
  const openSettings = () => {
    onClose();
    router.push('/settings/accessibility');
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('title')} description={t('description')} size="md" testId="accessibility-panel">
      <div className="space-y-1">
        <SettingItem label={tA('text_size.label')}>
          <Select
            value={settings.fontSize}
            onChange={(value) => set('fontSize', value as FontSize)}
            options={FONT_SIZES.map((size) => ({ value: size, label: tA(`text_size.${size}`) }))}
          />
        </SettingItem>
        <SettingItem label={tA('contrast.label')}>
          <RadioGroup
            value={settings.contrast}
            onChange={(value) => set('contrast', value)}
            options={[
              { value: 'system', label: tA('system') },
              { value: 'more', label: tA('contrast.more') },
              { value: 'normal', label: tA('contrast.normal') },
            ]}
          />
        </SettingItem>
        <SettingItem label={tA('reduce_motion.label')}>
          <RadioGroup
            value={settings.reduceMotion}
            onChange={(value) => set('reduceMotion', value)}
            options={[
              { value: 'system', label: tA('system') },
              { value: 'on', label: tA('on') },
              { value: 'off', label: tA('off') },
            ]}
          />
        </SettingItem>
        {signedIn && (
          <SettingItem label={tA('single_key_shortcuts.label')} locked={isSettingLocked('singleKeyShortcuts')}>
            <ToggleSwitch checked={settings.singleKeyShortcuts} onChange={(checked) => set('singleKeyShortcuts', checked)} />
          </SettingItem>
        )}
      </div>
      {signedIn && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-medium text-foreground">{tA('presets.title')}</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={tA('presets.title')}>
            {ACCESSIBILITY_PRESET_IDS.map((id) => (
              <Button key={id} variant="outline" size="sm" onClick={() => applyPreset(id)}>
                {tA(`presets.${id}.label`)}
              </Button>
            ))}
          </div>
          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {applied && (
              <span className="inline-flex items-center gap-2">
                {applied.changes.length === 0
                  ? tA('presets.nothing_changed', { name: tA(`presets.${applied.id}.label`) })
                  : t('preset_applied', { name: tA(`presets.${applied.id}.label`), count: applied.changes.length })}
                {applied.changes.length > 0 && (
                  <button
                    type="button"
                    className="underline text-foreground"
                    onClick={() => {
                      for (const change of applied.changes) set(change.key, change.from);
                      setApplied(null);
                    }}
                  >
                    {tA('presets.undo')}
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      )}
      {signedIn && (
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={openSettings}>{t('all_settings')}</Button>
        </div>
      )}
    </Dialog>
  );
}

/**
 * The quick accessibility panel: Alt+Shift+A anywhere, the optional rail
 * button, and a small button on the sign-in page, where text size, contrast
 * and motion are needed before anything else.
 */
export function AccessibilityQuickPanelHost() {
  const t = useTranslations('accessibility_panel');
  const [open, setOpen] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const pathname = usePathname();
  const onLoginPage = !isAuthenticated && /(^|\/)login(\/|$)/.test(pathname ?? '');

  useRegisterCommands(t('title'), [
    { id: 'accessibility-panel', label: t('command'), icon: Accessibility, shortcut: 'Alt + Shift + A', keywords: [t('command_keywords')], run: () => setOpen(true) },
  ], isAuthenticated);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAccessibilityPanelShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener(ACCESSIBILITY_PANEL_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener(ACCESSIBILITY_PANEL_EVENT, onOpen);
    };
  }, []);

  return (
    <>
      {onLoginPage && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 end-4 z-40 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm hover:bg-muted"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          data-testid="login-accessibility-button"
        >
          <Accessibility className="w-4 h-4" aria-hidden="true" />
          {t('button')}
        </button>
      )}
      {open && <QuickPanel isOpen={open} onClose={() => setOpen(false)} signedIn={isAuthenticated} />}
    </>
  );
}
