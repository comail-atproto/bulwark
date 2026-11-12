/**
 * Presets on Settings > Accessibility. A preset is a list of values applied
 * once: afterwards they are ordinary settings the user can change, and
 * several presets can be combined. Nothing remembers which preset was used,
 * so there is no hidden state to sync or lock.
 */

export type AccessibilityPresetId =
  | 'screen-reader'
  | 'low-vision'
  | 'dyslexia'
  | 'focus'
  | 'motor'
  | 'motion'
  | 'hearing';

export const ACCESSIBILITY_PRESET_IDS: readonly AccessibilityPresetId[] = [
  'screen-reader', 'low-vision', 'dyslexia', 'focus', 'motor', 'motion', 'hearing',
];

type PresetValues = Record<string, string | number | boolean>;

export const ACCESSIBILITY_PRESETS: Record<AccessibilityPresetId, PresetValues> = {
  // What Google and Microsoft tell screen reader users to set by hand: no
  // reading pane next to the list, no conversation grouping.
  'screen-reader': {
    mailLayout: 'focus',
    disableThreading: true,
    announceNewMail: true,
    announceRowPreview: true,
    showRowActionButton: true,
  },
  'low-vision': {
    fontSize: 'xx-large',
    contrast: 'more',
    focusRing: 'thick',
    underlineLinks: true,
    largeCursor: true,
    mailMinFontSize: 16,
    mailOverrideStyles: 'high-contrast',
    mailFitWidth: true,
    showToolbarLabels: true,
  },
  dyslexia: {
    appFont: 'atkinson',
    lineSpacing: 'relaxed',
    letterSpacing: 'wide',
    wordSpacing: 'wide',
    readingWidth: 'comfortable',
    plainTextFont: 'sans',
    mailOverrideStyles: 'always',
  },
  focus: {
    simpleMode: true,
    showPreview: false,
    senderFavicons: false,
    unreadCountStyle: 'dot',
    reduceMotion: 'on',
    pauseAnimatedImages: 'on',
  },
  motor: {
    largeTargets: 'on',
    density: 'comfortable',
    openOnHover: false,
    calendarHoverPreview: 'off',
    showRowActionButton: true,
    focusRing: 'thick',
    toastDuration: 20,
    confirmDelete: true,
    nativeScrollbars: true,
  },
  motion: {
    reduceMotion: 'on',
    pauseAnimatedImages: 'on',
    reduceTransparency: 'on',
    visualAlerts: false,
  },
  hearing: {
    visualAlerts: true,
    toastDuration: 0,
    emailNotificationSound: false,
    calendarNotificationSound: false,
  },
};

export interface PresetChange {
  key: string;
  from: unknown;
  to: unknown;
}

/**
 * The changes a preset would make to `state`: only values that differ, and
 * none the admin has locked (`isLocked`) or bounded (`allows`).
 */
export function presetChanges(
  id: AccessibilityPresetId,
  state: Record<string, unknown>,
  isLocked: (key: string) => boolean = () => false,
  allows: (key: string, value: unknown) => boolean = () => true,
): PresetChange[] {
  const changes: PresetChange[] = [];
  for (const [key, to] of Object.entries(ACCESSIBILITY_PRESETS[id])) {
    if (!(key in state) || state[key] === to || isLocked(key) || !allows(key, to)) continue;
    changes.push({ key, from: state[key], to });
  }
  return changes;
}

/**
 * Translation key of the row label for each setting a
 * preset touches, so the page can say what changed.
 */
export const PRESET_SETTING_LABELS: Record<string, string> = {
  mailLayout: 'settings.email_behavior.mail_layout.label',
  disableThreading: 'settings.email_behavior.group_conversations.label',
  showPreview: 'settings.email_behavior.show_preview.label',
  senderFavicons: 'settings.advanced.sender_favicons.label',
  density: 'settings.appearance.list_density.label',
  showToolbarLabels: 'settings.appearance.toolbar_labels.label',
  calendarHoverPreview: 'calendar.settings.hover_preview',
  emailNotificationSound: 'settings.notifications.email.sound',
  calendarNotificationSound: 'settings.notifications.calendar.sound',
  plainTextFont: 'settings.accessibility.plain_text_font.label',
  fontSize: 'settings.accessibility.text_size.label',
  contrast: 'settings.accessibility.contrast.label',
  reduceTransparency: 'settings.accessibility.transparency.label',
  underlineLinks: 'settings.accessibility.underline_links.label',
  appFont: 'settings.accessibility.font.label',
  lineSpacing: 'settings.accessibility.line_spacing.label',
  letterSpacing: 'settings.accessibility.letter_spacing.label',
  wordSpacing: 'settings.accessibility.word_spacing.label',
  readingWidth: 'settings.accessibility.reading_width.label',
  reduceMotion: 'settings.accessibility.reduce_motion.label',
  pauseAnimatedImages: 'settings.accessibility.pause_images.label',
  focusRing: 'settings.accessibility.focus_ring.label',
  largeTargets: 'settings.accessibility.large_targets.label',
  largeCursor: 'settings.accessibility.large_cursor.label',
  openOnHover: 'settings.accessibility.open_on_hover.label',
  showRowActionButton: 'settings.accessibility.row_action_button.label',
  nativeScrollbars: 'settings.accessibility.native_scrollbars.label',
  mailMinFontSize: 'settings.accessibility.mail_min_font_size.label',
  mailOverrideStyles: 'settings.accessibility.mail_override.label',
  mailFitWidth: 'settings.accessibility.mail_fit_width.label',
  toastDuration: 'settings.accessibility.toast_duration.label',
  confirmDelete: 'settings.accessibility.confirm_delete.label',
  visualAlerts: 'settings.accessibility.visual_alerts.label',
  unreadCountStyle: 'settings.accessibility.unread_counts.label',
  simpleMode: 'settings.accessibility.simple_mode.label',
  announceNewMail: 'settings.accessibility.announce_new_mail.label',
  announceRowPreview: 'settings.accessibility.announce_preview.label',
};
