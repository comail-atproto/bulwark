"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addYears, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CalendarRecurrenceRule } from "@/lib/jmap/types";
import { createRecurrenceRule } from "@/lib/recurrence-rule";

type EditorFrequency = "daily" | "weekly" | "monthly" | "yearly";
type MonthlyMode = "day" | "nth";
type EndsMode = "never" | "on" | "after";

const EDITOR_FREQUENCIES: EditorFrequency[] = ["daily", "weekly", "monthly", "yearly"];

// 2024-01-01 is a Monday - used to render localized weekday names via Intl.
const WEEKDAYS: string[] = ["mo", "tu", "we", "th", "fr", "sa", "su"];
const DAY_TO_REF_DATE: Record<string, number> = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };
const INDEX_TO_DAY = ["su", "mo", "tu", "we", "th", "fr", "sa"];

const UNIT_LABEL_KEYS: Record<EditorFrequency, string> = {
  daily: "recurrence.editor_unit_days",
  weekly: "recurrence.editor_unit_weeks",
  monthly: "recurrence.editor_unit_months",
  yearly: "recurrence.editor_unit_years",
};

type CalendarT = ReturnType<typeof useTranslations>;

function weekdayName(day: string, locale: string, style: "long" | "short" = "long"): string {
  const ref = new Date(2024, 0, DAY_TO_REF_DATE[day] ?? 1);
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(ref);
}

function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2024, month - 1, 1));
}

function nthLabel(nth: number, t: CalendarT): string {
  if (nth === -1) return t("recurrence.nth_last");
  if (nth >= 1 && nth <= 4) return t(`recurrence.nth_${nth}`);
  return String(nth);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Extract an "nth weekday" pattern from a rule, accepting both the
 * byDay+nthOfPeriod encoding and the byDay+bySetPosition encoding.
 */
function getNthDay(rule: CalendarRecurrenceRule): { day: string; nth: number } | null {
  if (rule.byDay?.length === 1) {
    const nd = rule.byDay[0];
    if (nd.nthOfPeriod) return { day: nd.day, nth: nd.nthOfPeriod };
    if (rule.bySetPosition?.length === 1) return { day: nd.day, nth: rule.bySetPosition[0] };
  }
  return null;
}

/**
 * True when the rule is exactly what the plain Daily/Weekly/Monthly/Yearly
 * dropdown presets produce, i.e. it needs no custom editor to represent.
 */
export function isSimpleRecurrenceRule(rule: CalendarRecurrenceRule): boolean {
  return (
    (EDITOR_FREQUENCIES as string[]).includes(rule.frequency) &&
    (!rule.interval || rule.interval === 1) &&
    !rule.byDay?.length &&
    !rule.byMonthDay?.length &&
    !rule.byMonth?.length &&
    !rule.byYearDay?.length &&
    !rule.byWeekNo?.length &&
    !rule.bySetPosition?.length &&
    !rule.count &&
    !rule.until
  );
}

/**
 * Human-readable summary of a recurrence rule, e.g.
 * "Every 2 months on the third Thursday · 12 occurrences".
 * Returns null for frequencies the UI cannot describe (hourly etc.).
 */
export function buildRecurrenceSummary(
  rule: CalendarRecurrenceRule,
  t: CalendarT,
  locale: string,
): string | null {
  const interval = rule.interval || 1;
  let base: string;
  switch (rule.frequency) {
    case "daily":
      base = interval > 1 ? t("recurrence.every_n_days", { count: interval }) : t("recurrence.daily");
      break;
    case "weekly":
      base = interval > 1 ? t("recurrence.every_n_weeks", { count: interval }) : t("recurrence.weekly");
      break;
    case "monthly":
      base = interval > 1 ? t("recurrence.every_n_months", { count: interval }) : t("recurrence.monthly");
      break;
    case "yearly":
      base = interval > 1 ? t("recurrence.every_n_years", { count: interval }) : t("recurrence.yearly");
      break;
    default:
      return null;
  }

  const parts = [base];

  if (rule.frequency === "weekly" && rule.byDay?.length) {
    const days = rule.byDay
      .filter((d) => WEEKDAYS.includes(d.day))
      .sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day))
      .map((d) => weekdayName(d.day, locale, "short"))
      .join(", ");
    if (days) parts.push(t("recurrence.on_days", { days }));
  }

  if (rule.frequency === "monthly" || rule.frequency === "yearly") {
    if (rule.frequency === "yearly" && rule.byMonth?.length) {
      const m = parseInt(rule.byMonth[0], 10);
      if (m >= 1 && m <= 12) parts.push(t("recurrence.in_month", { month: monthName(m, locale) }));
    }
    const nthDay = getNthDay(rule);
    if (nthDay) {
      parts.push(t("recurrence.on_the_nth", {
        nth: nthLabel(nthDay.nth, t),
        day: weekdayName(nthDay.day, locale),
      }));
    } else if (rule.byMonthDay?.length) {
      parts.push(t("recurrence.on_day_n", { day: rule.byMonthDay[0] }));
    }
  }

  let summary = parts.join(" ");
  if (rule.count) {
    summary += ` · ${t("recurrence.occurrences", { count: rule.count })}`;
  } else if (rule.until) {
    const d = new Date(rule.until);
    if (!isNaN(d.getTime())) {
      summary += ` · ${t("recurrence.until")} ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d)}`;
    }
  }
  return summary;
}

interface RecurrenceEditorProps {
  rule: CalendarRecurrenceRule | null;
  eventStart: Date;
  onSave: (rule: CalendarRecurrenceRule) => void;
  onCancel: () => void;
}

export function RecurrenceEditor({ rule, eventStart, onSave, onCancel }: RecurrenceEditorProps) {
  const t = useTranslations("calendar");
  const locale = useLocale();

  const startDay = INDEX_TO_DAY[eventStart.getDay()];
  const initialNthDay = rule ? getNthDay(rule) : null;

  const [frequency, setFrequency] = useState<EditorFrequency>(() =>
    rule && (EDITOR_FREQUENCIES as string[]).includes(rule.frequency)
      ? (rule.frequency as EditorFrequency)
      : "weekly"
  );
  const [interval, setIntervalValue] = useState<number>(rule?.interval || 1);
  const [weekDays, setWeekDays] = useState<string[]>(() => {
    if (rule?.frequency === "weekly" && rule.byDay?.length) {
      const days = rule.byDay.map((d) => d.day).filter((d) => WEEKDAYS.includes(d));
      if (days.length) return days;
    }
    return [startDay];
  });
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>(initialNthDay ? "nth" : "day");
  const [monthDay, setMonthDay] = useState<number>(() => {
    const md = rule?.byMonthDay?.[0];
    return md && md >= 1 && md <= 31 ? md : eventStart.getDate();
  });
  const [nth, setNth] = useState<number>(() => {
    if (initialNthDay && (initialNthDay.nth === -1 || (initialNthDay.nth >= 1 && initialNthDay.nth <= 4))) {
      return initialNthDay.nth;
    }
    return Math.min(4, Math.floor((eventStart.getDate() - 1) / 7) + 1);
  });
  const [nthDay, setNthDay] = useState<string>(() =>
    initialNthDay && WEEKDAYS.includes(initialNthDay.day) ? initialNthDay.day : startDay
  );
  const [month, setMonth] = useState<number>(() => {
    const m = rule?.byMonth?.length ? parseInt(rule.byMonth[0], 10) : NaN;
    return m >= 1 && m <= 12 ? m : eventStart.getMonth() + 1;
  });
  const [endsMode, setEndsMode] = useState<EndsMode>(rule?.count ? "after" : rule?.until ? "on" : "never");
  const [untilDate, setUntilDate] = useState<string>(() => {
    if (rule?.until) {
      const d = new Date(rule.until);
      if (!isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
    }
    return format(addYears(eventStart, 1), "yyyy-MM-dd");
  });
  const [count, setCount] = useState<number>(rule?.count ?? 12);

  const toggleWeekDay = (day: string) => {
    setWeekDays((prev) =>
      prev.includes(day)
        ? prev.length > 1 ? prev.filter((d) => d !== day) : prev
        : [...prev, day]
    );
  };

  const buildRule = (): CalendarRecurrenceRule => {
    const built: CalendarRecurrenceRule = createRecurrenceRule(frequency, {
      interval: Math.max(1, interval),
      count: endsMode === "after" ? Math.max(1, count) : null,
      until: endsMode === "on" && untilDate ? `${untilDate}T23:59:59` : null,
    });

    if (frequency === "weekly") {
      const days = weekDays.length ? weekDays : [startDay];
      built.byDay = WEEKDAYS.filter((d) => days.includes(d)).map((day) => ({ day }));
    } else if (frequency === "monthly" || frequency === "yearly") {
      if (monthlyMode === "nth") {
        built.byDay = [{ day: nthDay, nthOfPeriod: nth }];
      } else {
        built.byMonthDay = [Math.min(31, Math.max(1, monthDay))];
      }
      if (frequency === "yearly") {
        built.byMonth = [String(month)];
      }
    }

    return built;
  };

  const handleSave = () => onSave(buildRule());

  const summary = buildRecurrenceSummary(buildRule(), t, locale);

  const selectCls = "rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0">{t("recurrence.editor_every")}</span>
        <Input
          type="number"
          min={1}
          max={999}
          value={interval}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            setIntervalValue(Number.isFinite(n) ? Math.max(1, n) : 1);
          }}
          className="w-16 shrink-0"
          aria-label={t("recurrence.editor_every")}
        />
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as EditorFrequency)}
          className={`${selectCls} flex-1 min-w-0`}
          aria-label={t("recurrence.title")}
        >
          {EDITOR_FREQUENCIES.map((f) => (
            <option key={f} value={f}>{t(UNIT_LABEL_KEYS[f])}</option>
          ))}
        </select>
      </div>

      {frequency === "weekly" && (
        <div className="flex gap-1">
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleWeekDay(day)}
              title={weekdayName(day, locale)}
              aria-pressed={weekDays.includes(day)}
              className={
                weekDays.includes(day)
                  ? "flex-1 min-w-0 px-1 py-1.5 text-xs font-medium rounded-md border border-primary text-primary bg-primary/10 transition-colors"
                  : "flex-1 min-w-0 px-1 py-1.5 text-xs font-medium rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              }
            >
              {weekdayName(day, locale, "short")}
            </button>
          ))}
        </div>
      )}

      {frequency === "yearly" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0">{capitalize(t("recurrence.editor_in"))}</span>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className={`${selectCls} flex-1 min-w-0`}
            aria-label={t("recurrence.editor_in")}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{capitalize(monthName(m, locale))}</option>
            ))}
          </select>
        </div>
      )}

      {(frequency === "monthly" || frequency === "yearly") && (
        <div className="flex items-center gap-2 text-sm">
          <select
            value={monthlyMode}
            onChange={(e) => setMonthlyMode(e.target.value as MonthlyMode)}
            className={`${selectCls} shrink-0`}
            aria-label={t("recurrence.editor_repeats_on")}
          >
            <option value="day">{capitalize(t("recurrence.editor_on_day"))}</option>
            <option value="nth">{capitalize(t("recurrence.editor_on_the"))}</option>
          </select>
          {monthlyMode === "day" ? (
            <Input
              type="number"
              min={1}
              max={31}
              value={monthDay}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setMonthDay(Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1);
              }}
              className="w-16 shrink-0"
              aria-label={t("recurrence.editor_on_day")}
            />
          ) : (
            <>
              <select
                value={nth}
                onChange={(e) => setNth(parseInt(e.target.value, 10))}
                className={`${selectCls} flex-1 min-w-0`}
                aria-label={t("recurrence.editor_on_the")}
              >
                {[1, 2, 3, 4, -1].map((n) => (
                  <option key={n} value={n}>{capitalize(nthLabel(n, t))}</option>
                ))}
              </select>
              <select
                value={nthDay}
                onChange={(e) => setNthDay(e.target.value)}
                className={`${selectCls} flex-1 min-w-0`}
                aria-label={t("recurrence.editor_on_the")}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>{capitalize(weekdayName(d, locale))}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0">{t("recurrence.editor_ends")}</span>
        <select
          value={endsMode}
          onChange={(e) => setEndsMode(e.target.value as EndsMode)}
          className={`${selectCls} ${endsMode === "never" ? "flex-1" : "shrink-0"} min-w-0`}
          aria-label={t("recurrence.editor_ends")}
        >
          <option value="never">{t("recurrence.editor_never")}</option>
          <option value="on">{t("recurrence.until")}</option>
          <option value="after">{t("recurrence.editor_ends_after")}</option>
        </select>
        {endsMode === "on" && (
          <input
            type="date"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
            className={`${selectCls} flex-1 min-w-0`}
            aria-label={t("recurrence.editor_ends_on")}
          />
        )}
        {endsMode === "after" && (
          <>
            <Input
              type="number"
              min={1}
              max={999}
              value={count}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setCount(Number.isFinite(n) ? Math.max(1, n) : 1);
              }}
              className="w-16 shrink-0"
              aria-label={t("recurrence.editor_ends_after")}
            />
            <span className="text-muted-foreground truncate">{t("recurrence.editor_occurrences")}</span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground truncate min-w-0" title={summary ?? undefined}>
          {summary}
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("form.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("form.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
