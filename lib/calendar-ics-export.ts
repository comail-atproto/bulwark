import type { CalendarEvent } from "@/lib/jmap/types";

const MAX_LINE_OCTETS = 74;

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > MAX_LINE_OCTETS) {
      chunks.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += size;
  }
  chunks.push(current);
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

function stripDateSeparators(value: string): string {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateOnly(value: string): string {
  return value.replace(/-/g, "").substring(0, 8);
}

function formatNow(): string {
  return stripDateSeparators(new Date().toISOString().replace(/\.\d{3}/, ""));
}

function pushDateProp(
  lines: string[],
  prop: "DTSTART" | "DTEND" | "EXDATE",
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
  if (!rule) return;
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
  for (const [date, override] of Object.entries(event.recurrenceOverrides ?? {})) {
    if ("excluded" in override && override.excluded === true) {
      pushDateProp(lines, "EXDATE", date, event.showWithoutTime, event.timeZone);
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
  const scheduleAgent = isSpace ? ";SCHEDULE-AGENT=NONE" : "";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//JMAP-Webmail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    ...(!isSpace ? ["METHOD:PUBLISH"] : []),
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
  ];

  if (event.created) lines.push(`CREATED:${stripDateSeparators(event.created)}`);
  if (event.updated) lines.push(`LAST-MODIFIED:${stripDateSeparators(event.updated)}`);
  if (event.sequence != null) lines.push(`SEQUENCE:${event.sequence}`);

  if (event.start) {
    pushDateProp(lines, "DTSTART", event.start, event.showWithoutTime, event.timeZone);
  }
  if (event.utcEnd) {
    pushDateProp(lines, "DTEND", event.utcEnd, event.showWithoutTime, event.timeZone);
  } else if (event.duration) {
    lines.push(`DURATION:${event.duration}`);
  }

  if (event.title) lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
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
        const cn = organizer.name ? commonName(organizer.name) : "";
        lines.push(`ORGANIZER${cn}${scheduleAgent}:mailto:${email}`);
      }
    }
    for (const p of Object.values(event.participants)) {
      if (p.roles?.owner && !isSpace) continue;
      const email = p.email || p.sendTo?.imip?.replace("mailto:", "");
      const address = isSpace && p.did ? p.did : email ? `mailto:${email}` : null;
      if (!address) continue;
      const cn = p.name ? commonName(p.name) : "";
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
  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
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
