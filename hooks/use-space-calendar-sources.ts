"use client";

import { useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { isPublicAtprotoCalendar } from '@/lib/calendar-editability';
import { showSpaceCalendarAuthorization, showSpaceCalendarAuthorizationUrl } from '@/lib/space-calendar/authorization-ui';
import { useCalendarStore, type CalendarAccountClient } from '@/stores/calendar-store';
import { getClientByLocalAccountId } from '@/stores/client-registry';
import { toast } from '@/stores/toast-store';

interface CalendarSourceOptions {
  client: IJMAPClient | null;
  multiAccountEnabled: boolean;
  accountClients: CalendarAccountClient[];
  refetchCurrentRange: () => Promise<void>;
}

export function useSpaceCalendarSources({ client, multiAccountEnabled, accountClients, refetchCurrentRange }: CalendarSourceOptions) {
  const t = useTranslations('calendar');
  const { calendars, selectedCalendarIds, spaceCalendarAuthorizationUrl, clearSpaceCalendarAuthorizationUrl,
    toggleCalendarVisibility, fetchAllAccountsCalendars: fetchAllAccountsCalendarsFn, fetchCalendars } = useCalendarStore();
  const previousSelectedCalendarIds = useRef(selectedCalendarIds);
  const pendingConsentStarts = useRef(new Set<string>());
  const showSpaceAuthorization = useCallback((error: unknown) => showSpaceCalendarAuthorization(error, {
    title: t("notifications.space_calendar_authorization_title"),
    message: t("notifications.space_calendar_authorization_message"),
    actionLabel: t("notifications.space_calendar_authorize"),
  }), [t]);

  useEffect(() => {
    if (!spaceCalendarAuthorizationUrl) return;
    showSpaceCalendarAuthorizationUrl(spaceCalendarAuthorizationUrl, {
      title: t("notifications.space_calendar_authorization_title"),
      message: t("notifications.space_calendar_authorization_message"),
      actionLabel: t("notifications.space_calendar_authorize"),
    });
    clearSpaceCalendarAuthorizationUrl();
  }, [spaceCalendarAuthorizationUrl, clearSpaceCalendarAuthorizationUrl, t]);

  useEffect(() => {
    const previouslySelected = previousSelectedCalendarIds.current;
    previousSelectedCalendarIds.current = selectedCalendarIds;
    const newlySelected = selectedCalendarIds.filter((id) => !previouslySelected.includes(id));
    const pendingCalendar = calendars.find((calendar) => calendar.spaceConsentRequired && !isPublicAtprotoCalendar(calendar) && newlySelected.includes(calendar.id));
    if (!pendingCalendar || pendingConsentStarts.current.has(pendingCalendar.id)) return;
    const consentClient = pendingCalendar.localAccountId
      ? getClientByLocalAccountId(pendingCalendar.localAccountId)
      : client;
    if (!consentClient?.startAtprotoSpaceCalendarConsent) return;

    pendingConsentStarts.current.add(pendingCalendar.id);
    void consentClient.startAtprotoSpaceCalendarConsent()
      .then((authorizationUrl) => { showSpaceCalendarAuthorizationUrl(authorizationUrl, {
        title: t("notifications.space_calendar_authorization_title"),
        message: t("notifications.space_calendar_authorization_message"),
        actionLabel: t("notifications.space_calendar_authorize"),
      }); })
      .catch((error) => {
        if (!showSpaceAuthorization(error)) toast.error(t("notifications.space_calendar_consent_start_failed"));
      })
      .finally(() => pendingConsentStarts.current.delete(pendingCalendar.id));
  }, [client, calendars, selectedCalendarIds, showSpaceAuthorization, t]);

  const pendingSourceChanges = useRef(new Set<string>());
  const handleToggleCalendarVisibility = useCallback(async (calendarId: string) => {
    const calendar = calendars.find(item => item.id === calendarId);
    if (!isPublicAtprotoCalendar(calendar ?? { id: calendarId })) {
      toggleCalendarVisibility(calendarId);
      return;
    }
    if (!calendar || pendingSourceChanges.current.has(calendarId)) return;
    const sourceClient = calendar.localAccountId ? getClientByLocalAccountId(calendar.localAccountId) : client;
    if (!sourceClient?.startAtmoCalendarConsent || !sourceClient.setAtmoCalendarEnabled) return;
    pendingSourceChanges.current.add(calendarId);
    try {
      if (calendar.spaceConsentRequired) {
        const authorizationUrl = await sourceClient.startAtmoCalendarConsent();
        showSpaceCalendarAuthorizationUrl(authorizationUrl, {
          title: t("notifications.space_calendar_authorization_title"),
          message: t("notifications.space_calendar_authorization_message"),
          actionLabel: t("notifications.space_calendar_authorize"),
        });
        return;
      }
      await sourceClient.setAtmoCalendarEnabled(!calendar.isVisible);
      if (multiAccountEnabled && accountClients.length > 0) await fetchAllAccountsCalendarsFn(accountClients);
      else await fetchCalendars(sourceClient);
      await refetchCurrentRange();
    } catch (failure) {
      if (!showSpaceAuthorization(failure)) toast.error(t("atmo.preference_failed"));
      if (multiAccountEnabled && accountClients.length > 0) await fetchAllAccountsCalendarsFn(accountClients);
      else await fetchCalendars(sourceClient);
    } finally {
      pendingSourceChanges.current.delete(calendarId);
    }
  }, [calendars, client, toggleCalendarVisibility, multiAccountEnabled, accountClients, fetchAllAccountsCalendarsFn, fetchCalendars, refetchCurrentRange, showSpaceAuthorization, t]);

  return { showSpaceAuthorization, handleToggleCalendarVisibility };
}
