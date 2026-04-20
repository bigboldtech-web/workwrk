// Minimal RFC 5545 iCal generator. Tuned for Workwrk's task + meeting
// export needs — we don't emit TZID blocks; every time is rendered as
// UTC (suffix "Z") which is lossless and accepted by Apple Calendar,
// Google Calendar, and Outlook.
//
// Each event needs a stable UID so subscribers can detect updates and
// deletions across refreshes. We use `${kind}:${id}@workwrk.com` so
// the same task always emits the same UID.

export interface ICalEvent {
  kind: "task" | "meeting";
  id: string;
  title: string;
  description?: string | null;
  startAt: Date;
  endAt: Date;
  allDay?: boolean;
  updatedAt?: Date;
  url?: string;
  status?: "CONFIRMED" | "CANCELLED";
}

function fold(line: string): string {
  // RFC 5545 §3.1: lines SHOULD be folded at 75 octets. Simple approach
  // that covers the 99% of titles we see.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function renderICalendar(events: ICalEvent[], opts: { calendarName: string; refreshMinutes?: number }): string {
  const refresh = opts.refreshMinutes ?? 15;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Workwrk//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${escapeText(opts.calendarName)}`),
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}M`,
    `X-PUBLISHED-TTL:PT${refresh}M`,
  ];

  const now = new Date();
  for (const ev of events) {
    const uid = `${ev.kind}:${ev.id}@workwrk.com`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${formatUTC(ev.updatedAt ?? now)}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDate(ev.startAt)}`);
      // All-day DTEND in iCal is exclusive — add one day.
      const end = new Date(ev.endAt);
      end.setDate(end.getDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${formatDate(end)}`);
    } else {
      lines.push(`DTSTART:${formatUTC(ev.startAt)}`);
      lines.push(`DTEND:${formatUTC(ev.endAt)}`);
    }
    lines.push(fold(`SUMMARY:${escapeText(ev.title)}`));
    if (ev.description) lines.push(fold(`DESCRIPTION:${escapeText(ev.description)}`));
    if (ev.url) lines.push(fold(`URL:${ev.url}`));
    lines.push(`STATUS:${ev.status ?? "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
