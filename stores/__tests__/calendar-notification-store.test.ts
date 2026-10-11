import { describe, it, expect, beforeEach } from 'vitest';
import { useCalendarNotificationStore } from '../calendar-notification-store';

const RETENTION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function getStore() {
  return useCalendarNotificationStore.getState();
}

describe('calendar-notification-store', () => {
  beforeEach(() => {
    getStore().clearAll();
  });

  it('starts with empty acknowledged alerts', () => {
    expect(getStore().acknowledgedAlerts).toEqual({});
  });

  it('acknowledges an alert with key and fireTimeMs', () => {
    getStore().acknowledgeAlert('evt-1:a1:1000', 1000);
    expect(getStore().acknowledgedAlerts).toEqual({ 'evt-1:a1:1000': 1000 });
  });

  it('acknowledges multiple alerts', () => {
    getStore().acknowledgeAlert('key1', 1000);
    getStore().acknowledgeAlert('key2', 2000);
    expect(Object.keys(getStore().acknowledgedAlerts)).toHaveLength(2);
  });

  it('isAcknowledged returns true for acknowledged keys', () => {
    getStore().acknowledgeAlert('key1', 1000);
    expect(getStore().isAcknowledged('key1')).toBe(true);
  });

  it('isAcknowledged returns false for unknown keys', () => {
    expect(getStore().isAcknowledged('unknown')).toBe(false);
  });

  it('clearAll empties the map', () => {
    getStore().acknowledgeAlert('key1', 1000);
    getStore().acknowledgeAlert('key2', 2000);
    getStore().clearAll();
    expect(getStore().acknowledgedAlerts).toEqual({});
  });

  it('cleanupStaleAlerts removes entries older than 24 hours', () => {
    const now = Date.now();
    const old = now - RETENTION_THRESHOLD_MS - 1000;
    const recent = now - 1000;

    getStore().acknowledgeAlert('old', old);
    getStore().acknowledgeAlert('recent', recent);
    getStore().cleanupStaleAlerts();

    expect(getStore().isAcknowledged('old')).toBe(false);
    expect(getStore().isAcknowledged('recent')).toBe(true);
  });

  it('cleanupStaleAlerts keeps entries at exactly the threshold', () => {
    const now = Date.now();
    const atThreshold = now - RETENTION_THRESHOLD_MS + 100;

    getStore().acknowledgeAlert('boundary', atThreshold);
    getStore().cleanupStaleAlerts();

    expect(getStore().isAcknowledged('boundary')).toBe(true);
  });
});
