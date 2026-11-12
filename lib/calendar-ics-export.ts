import type { CalendarEvent } from "@/lib/jmap/types";
import { descriptionAsText } from "@/lib/calendar-description";
import { isRuleOccurrence } from "@/lib/recurrence-expansion";

const MAX_LINE_OCTETS = 75;
const utf8 = new TextEncoder();

// RFC 5545 §3.1: lines of at most 75 octets, folded between characters. Cut
// by UTF-16 units, a fold could split an emoji, which the file then held as
// two U+FFFD.
function foldLine(line: string): string {
  const chunks: string[] = [];
  let chunk = "";
  let octets = 0;
  for (const char of line) {
    const size = utf8.encode(char).length;
    if (octets + size > MAX_LINE_OCTETS) {
      chunks.push(chunk);
      chunk = " ";
      octets = 1;
    }
    chunk += char;
    octets += size;
  }
  chunks.push(chunk);
  return chunks.join("\r\n");
}

// RFC 6868 parameter encoding keeps names containing delimiters or newlines
// inside a single quoted parameter; TEXT escaping does not apply to parameters.
function commonName(value: string): string {
  return `;CN="${value.replace(/\^/g, "^^").replace(/\r\n|\r|\n/g, "^n").replace(/"/g, "^'")}"`;
}

// RFC 5545 §3.3.11 - escape backslash, semicolon, comma, and newline in TEXT values.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// RFC 5545 §3.2: a parameter value holding ":", ";" or "," is quoted, and
// can't hold a DQUOTE or a line break. Unquoted, "CN=Ops: Alice" ended the
// parameters at the colon.
function paramValue(value: string): string {
  const clean = value.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
  return /[:;,]/.test(clean) ? `"${clean}"` : clean;
}

function stripDateSeparators(value: string): string {
  return value.replace(/[-:]/g, "").replace(/\.\d+/, "");
}

function dateOnly(value: string): string {
  return value.replace(/-/g, "").substring(0, 8);
}

function usesDateValue(event: CalendarEvent): boolean {
  // Space events have an explicit timezone; showWithoutTime changes their display.
  return event.source !== "atproto-space" && event.showWithoutTime;
}

function formatNow(): string {
  return stripDateSeparators(new Date().toISOString().replace(/\.\d{3}/, ""));
}

function pushDateProp(
  lines: string[],
  prop: "DTSTART" | "DTEND" | "EXDATE" | "RDATE" | "RECURRENCE-ID",
  value: string,
  showWithoutTime: boolean,
  tz?: string | null,
): void {
  if (showWithoutTime) {
    lines.push(`${prop};VALUE=DATE:${dateOnly(value)}`);
    return;
  }
  if (value.endsWith("Z")) {
    lines.push(`${prop}:${stripDateSeparators(value)}`);
    return;
  }
  const basic = stripDateSeparators(value);
  if (tz) {
    lines.push(`${prop};TZID=${tz}:${basic}`);
  } else {
    lines.push(`${prop}:${basic}`);
  }
}

function pushFrequencyRule(lines: string[], event: CalendarEvent): void {
  const rule = event.recurrenceRules?.[0];
  if (rule) {
    const parts: string[] = [`FREQ=${rule.frequency.toUpperCase()}`];
    if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
    if (rule.count != null) parts.push(`COUNT=${rule.count}`);
    if (rule.until) parts.push(`UNTIL=${stripDateSeparators(rule.until)}`);
    if (rule.byDay?.length) {
      const days = rule.byDay
        .map((d) => `${d.nthOfPeriod ?? ""}${d.day.toUpperCase()}`)
        .join(",");
      parts.push(`BYDAY=${days}`);
    }
    if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
    if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
    lines.push(`RRULE:${parts.join(";")}`);
  }
  for (const [date, override] of Object.entries(event.recurrenceOverrides ?? {})) {
    if ("excluded" in override && override.excluded === true) {
      pushDateProp(lines, "EXDATE", date, usesDateValue(event), event.timeZone);
    } else if (!isRuleOccurrence(event, date)) {
      pushDateProp(lines, "RDATE", date, usesDateValue(event), event.timeZone);
    }
  }
}

function pushAlerts(lines: string[], event: CalendarEvent): void {
  if (!event.alerts) return;
  for (const alert of Object.values(event.alerts)) {
    const trigger = alert.trigger;
    if (!trigger) continue;
    lines.push("BEGIN:VALARM");
    lines.push(`ACTION:${(alert.action || "display").toUpperCase()}`);
    if (trigger["@type"] === "OffsetTrigger") {
      const related = trigger.relativeTo === "end" ? ";RELATED=END" : "";
      lines.push(`TRIGGER${related}:${trigger.offset}`);
    } else if (trigger["@type"] === "AbsoluteTrigger") {
      lines.push(`TRIGGER;VALUE=DATE-TIME:${stripDateSeparators(trigger.when)}`);
    }
    lines.push(`DESCRIPTION:${escapeText(event.title || "Reminder")}`);
    lines.push("END:VALARM");
  }
}

export function eventToICS(event: CalendarEvent): string {
  const now = formatNow();
  const isSpace = event.source === "atproto-space";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Bulwark Mail//Bulwark Webmail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    ...(!isSpace ? ["METHOD:PUBLISH"] : []),
  ];
  lines.push(...eventComponent(event, now));
  for (const [date, patch] of Object.entries(event.recurrenceOverrides ?? {})) {
    if ("excluded" in patch && patch.excluded === true) continue;
    const instance = { ...event, start: date, ...patch, uid: event.uid, source: event.source, spaceOwnerDid: event.spaceOwnerDid, utcStart: null, utcEnd: null, recurrenceRules: null, recurrenceOverrides: null } as CalendarEvent;
    lines.push(...eventComponent(instance, now, { date, base: event }));
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function eventComponent(event: CalendarEvent, now: string, recurrence?: { date: string; base: CalendarEvent }): string[] {
  const isSpace = event.source === "atproto-space";
  const scheduleAgent = isSpace ? ";SCHEDULE-AGENT=NONE" : "";
  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
  ];
  if (recurrence) pushDateProp(lines, "RECURRENCE-ID", recurrence.date, usesDateValue(recurrence.base), recurrence.base.timeZone);
  if (isSpace && event.showWithoutTime) lines.push("SHOW-WITHOUT-TIME:TRUE");

  if (event.created) lines.push(`CREATED:${stripDateSeparators(event.created)}`);
  if (event.updated) lines.push(`LAST-MODIFIED:${stripDateSeparators(event.updated)}`);
  if (event.sequence != null) lines.push(`SEQUENCE:${event.sequence}`);

  if (event.start) {
    pushDateProp(lines, "DTSTART", event.start, usesDateValue(event), event.timeZone);
  }
  if (event.utcEnd) {
    pushDateProp(lines, "DTEND", event.utcEnd, usesDateValue(event), event.timeZone);
  } else if (event.duration) {
    lines.push(`DURATION:${event.duration}`);
  }

  if (event.title) lines.push(`SUMMARY:${escapeText(event.title)}`);
  // DESCRIPTION is plain text; an HTML description goes out as its text.
  const description = descriptionAsText(event);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (event.status) lines.push(`STATUS:${event.status.toUpperCase()}`);
  if (event.privacy) lines.push(`CLASS:${event.privacy.toUpperCase()}`);
  if (event.freeBusyStatus) {
    lines.push(`TRANSP:${event.freeBusyStatus === "free" ? "TRANSPARENT" : "OPAQUE"}`);
  }

  if (event.locations) {
    const first = Object.values(event.locations)[0];
    if (first?.name) lines.push(`LOCATION:${escapeText(first.name)}`);
  }
  if (event.virtualLocations) {
    for (const loc of Object.values(event.virtualLocations)) {
      if (loc.uri) lines.push(`URL:${loc.uri}`);
    }
  }

  if (isSpace && event.spaceOwnerDid) {
    lines.push(`ORGANIZER${scheduleAgent}:${event.spaceOwnerDid}`);
  }
  if (event.participants) {
    const organizer = Object.values(event.participants).find((p) => p.roles?.owner);
    if (organizer && !(isSpace && event.spaceOwnerDid)) {
      const email = organizer.email || organizer.sendTo?.imip?.replace("mailto:", "");
      if (email) {
        const cn = organizer.name ? (isSpace ? commonName(organizer.name) : `;CN=${paramValue(organizer.name)}`) : "";
        lines.push(`ORGANIZER${cn}${scheduleAgent}:mailto:${email}`);
      }
    }
    for (const p of Object.values(event.participants)) {
      if (p.roles?.owner && !isSpace) continue;
      const email = p.email || p.sendTo?.imip?.replace("mailto:", "");
      const address = isSpace && p.did ? p.did : email ? `mailto:${email}` : null;
      if (!address) continue;
      const cn = p.name ? (isSpace ? commonName(p.name) : `;CN=${paramValue(p.name)}`) : "";
      const partstat = p.participationStatus
        ? `;PARTSTAT=${p.participationStatus.toUpperCase()}`
        : ";PARTSTAT=NEEDS-ACTION";
      const rsvp = p.expectReply ? ";RSVP=TRUE" : "";
      lines.push(`ATTENDEE${cn}${scheduleAgent}${partstat}${rsvp}:${address}`);
    }
  }

  pushFrequencyRule(lines, event);
  pushAlerts(lines, event);

  lines.push("END:VEVENT");
  return lines;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "event";
}

export function downloadEventICS(event: CalendarEvent): void {
  const ics = eventToICS(event);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(event.title || "event")}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
