"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Loader2, UserPlus, Trash2, ChevronDown, Share2 } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { Principal, Calendar, PrincipalDirectoryStatus, CalendarRights } from "@/lib/jmap/types";
import { detectPreset as detectJmapPreset, presetRights as jmapPresetRights, type AnyRights, type RolePreset, type ShareKind } from "@/lib/jmap/share-rights";
import { loadPrincipalDirectory } from "@/lib/jmap/principal-directory";
import { toast } from "@/stores/toast-store";
import { useRestriction } from "@/hooks/use-restriction";
import { allowedLevels } from "@/lib/delegation/delegation";
import { OrgLockedNote } from "./org-locked-note";
import { showSpaceCalendarAuthorization } from "@/lib/space-calendar/authorization-ui";
import { SpaceCalendarError } from "@/lib/jmap/space-calendar-adapter";
import { presetForSpaceOfferRole, spaceSharePresetOptions } from "@/lib/space-calendar/share-role";


function presetRights(kind: ShareKind, preset: RolePreset, calendarSource?: Calendar['source']): AnyRights | undefined {
  if (kind === "calendar" && calendarSource === 'atproto-space') {
    if (preset === 'read') return spaceRoleRights('viewer');
    if (preset === 'readWrite') return spaceRoleRights('editor');
    return undefined;
  }
  return jmapPresetRights(kind, preset);
}

function detectPreset(kind: ShareKind, rights: AnyRights, calendarSource?: Calendar['source']): RolePreset {
  if (kind === "calendar" && calendarSource === 'atproto-space') {
    if (sameCalendarRights(rights as CalendarRights, spaceRoleRights('viewer'))) return 'read';
    if (sameCalendarRights(rights as CalendarRights, spaceRoleRights('editor'))) return 'readWrite';
    return 'custom';
  }
  return detectJmapPreset(kind, rights);
}

function spaceRoleRights(role: 'viewer' | 'editor'): CalendarRights {
  return {
    mayReadFreeBusy: false,
    mayReadItems: true,
    mayWriteAll: role === 'editor',
    mayWriteOwn: false,
    mayUpdatePrivate: false,
    mayRSVP: role === 'editor',
    mayShare: false,
    mayDelete: false,
  };
}

function sameCalendarRights(left: CalendarRights, right: CalendarRights): boolean {
  return (Object.keys(right) as (keyof CalendarRights)[]).every(key => left[key] === right[key]);
}

interface ShareCollectionDialogProps {
  client: IJMAPClient;
  kind: ShareKind;
  collectionName: string;
  shareWith: Record<string, AnyRights> | null | undefined;
  ownAccountId: string;
  calendarSource?: Calendar['source'];
  spaceOfferRole?: Calendar['spaceOfferRole'];
  principalLoader?: () => Promise<Principal[]>;
  onShare: (principalId: string, rights: AnyRights | null) => Promise<void>;
  onClose: () => void;
}

export function ShareCollectionDialog({
  client,
  kind,
  collectionName,
  shareWith,
  ownAccountId,
  calendarSource,
  spaceOfferRole,
  principalLoader,
  onShare,
  onClose,
}: ShareCollectionDialogProps) {
  const t = useTranslations("sharing");
  const tCommon = useTranslations("common");
  const tCalendar = useTranslations("calendar");
  const showSpaceAuthorization = useCallback((error: unknown) => showSpaceCalendarAuthorization(error, {
    title: tCalendar("notifications.space_calendar_authorization_title"),
    message: tCalendar("notifications.space_calendar_authorization_message"),
    actionLabel: tCalendar("notifications.space_calendar_authorize"),
  }), [tCalendar]);
  const reportShareFailure = (error: unknown) => {
    if (showSpaceAuthorization(error)) return;
    if (error instanceof SpaceCalendarError) {
      if (error.code === 'consent_required') toast.info(tCalendar("notifications.space_calendar_consent_pending"));
      else if (error.code === 'unsupported_operation') toast.error(tCalendar("notifications.space_calendar_unsupported_operation"));
      else toast.error(t("share_failed"));
      return;
    }
    toast.error(error instanceof Error ? error.message : t("share_failed"));
  };
  const [allPrincipals, setAllPrincipals] = useState<Principal[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<PrincipalDirectoryStatus>("ok");
  const [directoryQueriesOff, setDirectoryQueriesOff] = useState(false);
  const [loadingPrincipals, setLoadingPrincipals] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // The admin's `sharingRights`: without write, only the read presets.
  const sharingRights = useRestriction("sharingRights");
  const writeAllowed = allowedLevels(sharingRights.allowedValues).includes("write");
  const principalLoaderRef = useRef(principalLoader);
  principalLoaderRef.current = principalLoader;

  // Load principals on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingPrincipals(true);
    const listing = principalLoaderRef.current
      ? principalLoaderRef.current().then(principals => ({ principals, status: "ok" as const, directoryQueriesOff: false }))
        .catch(() => ({ principals: [], status: "error" as const, directoryQueriesOff: false }))
      : loadPrincipalDirectory(client);
    void listing.then(({ principals, status, directoryQueriesOff }) => {
      if (cancelled) return;
      setAllPrincipals(principals);
      setDirectoryStatus(status);
      setDirectoryQueriesOff(!!directoryQueriesOff);
      setLoadingPrincipals(false);
    });
    return () => { cancelled = true; };
  }, [client]);

  // Map of every fetched principal by id, used for name/description lookups in
  // the shared list. Must include principals that already have a share so the
  // list shows their name rather than the raw id.
  const allPrincipalsById = useMemo(() => {
    const map = new Map<string, Principal>();
    for (const p of allPrincipals) map.set(p.id, p);
    return map;
  }, [allPrincipals]);

  // Principals available to add: exclude self and anyone already shared with.
  const principals = useMemo(() => {
    const existing = new Set(Object.keys(shareWith || {}));
    return allPrincipals.filter((p) => p.id !== ownAccountId && !existing.has(p.id));
  }, [allPrincipals, ownAccountId, shareWith]);

  const jmapPresetOptions: RolePreset[] = [
    ...(kind === "calendar" ? ["freeBusy" as const] : []),
    "read",
    ...(writeAllowed ? ["readWrite" as const, "manager" as const] : []),
  ];

  const presetOptions = kind === "calendar" && calendarSource === 'atproto-space'
    ? spaceSharePresetOptions(spaceOfferRole).filter((preset) => writeAllowed || preset === 'read')
    : jmapPresetOptions;

  const handleSetRights = async (principalId: string, preset: RolePreset) => {
    if (preset === "custom") return; // custom is read-only here
    if (!(presetOptions as readonly RolePreset[]).includes(preset)) return;
    const rights = presetRights(kind, preset, calendarSource);
    if (!rights) return;
    setSavingId(principalId);
    try {
      await onShare(principalId, rights);
      toast.success(t("share_updated"));
    } catch (err) {
      reportShareFailure(err);
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (principalId: string) => {
    setSavingId(principalId);
    try {
      await onShare(principalId, null);
      toast.success(t("share_removed"));
    } catch (err) {
      reportShareFailure(err);
    } finally {
      setSavingId(null);
    }
  };

  const handleAdd = async (principal: Principal) => {
    const addPreset = calendarSource === 'atproto-space'
      ? spaceOfferRole ? presetForSpaceOfferRole(spaceOfferRole) : undefined
      : 'read';
    if (!addPreset) return;
    const rights = presetRights(kind, addPreset, calendarSource);
    if (!rights) return;
    setSavingId(principal.id);
    try {
      await onShare(principal.id, rights);
      setShowAdd(false);
      setSearch("");
      toast.success(t("share_added"));
    } catch (err) {
      reportShareFailure(err);
    } finally {
      setSavingId(null);
    }
  };

  const filteredPrincipals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return principals;
    return principals.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }, [principals, search]);

  const sharedEntries = useMemo(() => {
    return Object.entries(shareWith || {}) as [string, AnyRights][];
  }, [shareWith]);



  return (
    // The shared dialog shell (R4): focus moves in and comes back, Escape
    // and the close X work from anywhere in it.
    <Dialog
      isOpen
      onClose={onClose}
      title={t("title", { name: collectionName })}
      icon={<Share2 className="w-5 h-5 text-primary shrink-0 mt-1" />}
      size="lg"
      footer={<Button onClick={onClose}>{tCommon("close")}</Button>}
    >
        <div className="pt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{calendarSource === 'atproto-space' ? t("space_calendar_description") : t("description")}</p>
          {!writeAllowed && <OrgLockedNote />}

          {sharedEntries.length === 0 && !showAdd && (
            <div className="text-sm text-muted-foreground italic py-4 text-center">
              {t("no_shares")}
            </div>
          )}

          {sharedEntries.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
              {sharedEntries.map(([principalId, rights]) => {
                const principal = allPrincipalsById.get(principalId);
                // Stalwart 1.0 with directory queries off hides every principal
                // the user has no relationship with, so a sharee may have no name.
                const unresolved = !principal && !loadingPrincipals;
                const preset = detectPreset(kind, rights, calendarSource);
                return (
                  <li key={principalId} className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar
                      name={principal?.name}
                      email={principal?.email ?? undefined}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {principal?.name || principal?.email || (unresolved ? t("unknown_user") : principalId)}
                      </div>
                      {unresolved && (
                        <div className="text-xs text-muted-foreground truncate">{principalId}</div>
                      )}
                      {principal?.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {principal.description}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <select
                        aria-label={t("access_for", { name: principal?.name || principal?.email || principalId })}
                        value={preset}
                        onChange={(e) => handleSetRights(principalId, e.target.value as RolePreset)}
                        disabled={savingId === principalId}
                        className="appearance-none rounded-md border border-input bg-background ps-3 pe-8 py-1.5 text-xs focus:outline-hidden disabled:opacity-50"
                      >
                        {presetOptions.map((p) => (
                          <option key={p} value={p}>{t(`preset.${p}`)}</option>
                        ))}
                        {/* A grant the admin no longer lets users give stays named, but can't be picked. */}
                        {!presetOptions.includes(preset) && (
                          <option value={preset} disabled>{t(`preset.${preset}`)}</option>
                        )}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                    </div>
                    <button
                      onClick={() => handleRemove(principalId)}
                      disabled={savingId === principalId}
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      aria-label={t("remove")}
                      title={t("remove")}
                    >
                      {savingId === principalId
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!showAdd && (
            <Button
              variant="outline"
              onClick={() => setShowAdd(true)}
              className="w-full"
            >
              <UserPlus className="w-4 h-4 me-2" />
              {t("add_person")}
            </Button>
          )}

          {showAdd && (
            <div className="space-y-2 border border-border rounded-md p-3">
              <input
                aria-label={t("search_placeholder")}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search_placeholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-hidden"
                autoFocus
              />
              {/* The list below is partial or empty for a reason the user
                  can't see otherwise; say so instead of "no users found". Only
                  Stalwart 1.0's own refusal says who is still listed and what
                  an administrator can do: a 0.16 role without the permission
                  gets another refusal, and a list of everyone after it. */}
              {!loadingPrincipals && directoryStatus !== "ok" && (
                <p className="text-xs text-muted-foreground" role="status">
                  {directoryStatus === "error"
                    ? t("directory_failed")
                    : directoryQueriesOff ? t("directory_restricted") : t("directory_not_browsable")}
                </p>
              )}
              <div className="max-h-48 overflow-y-auto -mx-1">
                {loadingPrincipals && (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin me-2" />
                    {t("loading_principals")}
                  </div>
                )}
                {!loadingPrincipals && filteredPrincipals.length === 0 && (search.trim() || directoryStatus === "ok") && (
                  <div className="text-xs text-muted-foreground text-center py-3">
                    {search.trim() ? t("no_match") : t("no_principals")}
                  </div>
                )}
                {!loadingPrincipals && filteredPrincipals.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    disabled={savingId === p.id}
                    className="w-full text-start px-3 py-2 rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar
                        name={p.name}
                        email={p.email ?? undefined}
                        size="sm"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-2">
                          {p.name}
                          {p.type === "group" && (
                            <span className="text-[0.6875rem] font-normal text-muted-foreground bg-muted rounded px-1 py-0.5">
                              {t("group")}
                            </span>
                          )}
                        </div>
                        {p.email && p.email !== p.name && (
                          <div dir="ltr" className="text-xs text-muted-foreground truncate rtl:text-right">{p.email}</div>
                        )}
                      </div>
                      {savingId === p.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setSearch(""); }}>
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>

    </Dialog>
  );
}
