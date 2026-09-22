// A <input type="datetime-local"> that means the VIEWER'S time zone.
//
// THE PROBLEM THIS SOLVES. `datetime-local` has no zone: the browser reads
// and writes wall-clock parts in whatever zone the machine is set to. Every
// other time on our screens goes through home.locale.timezone
// (src/lib/format/date.ts). Put the two beside each other and the same
// meeting reads two ways at once: the Meetings header said "Fri 25 Sep,
// 6:00 AM" (the viewer's zone, America/New_York) while the editable When row
// under it said "25/09/2026, 03:30 PM" (the machine's zone, IST) for the
// same instant.
//
// So the input's value is FORMATTED into the viewer's zone on the way in and
// INTERPRETED as the viewer's zone on the way out, and the browser's own
// zone never enters it.
//
// Pure: no React, no prisma, only Intl, which node has. Every rule below is
// unit-tested, including the two that only bite twice a year.

const PAD = (n: number) => String(n).padStart(2, "0");

/** The wall-clock parts of `instant` in `timeZone`. */
function partsIn(instant: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type === "literal") continue;
    // "24" is how en-US hour12:false spells midnight in some runtimes.
    out[p.type] = p.value === "24" ? 0 : Number(p.value);
  }
  return {
    year: out.year, month: out.month, day: out.day,
    hour: out.hour, minute: out.minute, second: out.second ?? 0,
  };
}

/** How far `timeZone` is from UTC at `instant`, in milliseconds. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Seconds are compared, milliseconds are not: formatToParts drops them.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * An instant as the "YYYY-MM-DDTHH:mm" a datetime-local input wants, read
 * in `timeZone`.
 *
 * An empty or unreadable zone falls back to the machine's own, which is what
 * the input did before this module existed, so nothing regresses when
 * home.locale.timezone is unset.
 */
export function zonedInputValue(iso: string | Date, timeZone?: string | null): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (!timeZone) {
    return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
  }
  try {
    const p = partsIn(d, timeZone);
    return `${p.year}-${PAD(p.month)}-${PAD(p.day)}T${PAD(p.hour)}:${PAD(p.minute)}`;
  } catch {
    // An invalid IANA name must not take the field down.
    return zonedInputValue(d, null);
  }
}

/**
 * The instant a "YYYY-MM-DDTHH:mm" names in `timeZone`, as an ISO string.
 *
 * TWO PASSES, and the second one is not decoration. The offset of a zone
 * depends on the instant, and the instant is what we are solving for, so the
 * first guess uses the offset at the naive UTC reading and the second uses
 * the offset at the answer that produced. Without it, a wall-clock time on
 * the far side of a daylight-saving change lands an hour out: a 10:00 AM
 * meeting booked in March would save as 09:00 or 11:00.
 *
 * Returns null for anything unreadable, so a caller never saves an
 * Invalid Date over a real time.
 */
export function zonedInputToIso(value: string, timeZone?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  if (!timeZone) {
    const local = new Date(y, mo - 1, d, h, mi, s);
    return Number.isNaN(local.getTime()) ? null : local.toISOString();
  }

  try {
    const naive = Date.UTC(y, mo - 1, d, h, mi, s);
    let guess = new Date(naive - offsetMsAt(new Date(naive), timeZone));
    guess = new Date(naive - offsetMsAt(guess, timeZone));
    return Number.isNaN(guess.getTime()) ? null : guess.toISOString();
  } catch {
    return zonedInputToIso(value, null);
  }
}
