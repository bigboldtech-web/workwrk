// The personal calendar entry's small rules, in one pure module so the route,
// the popover and the modal cannot disagree about them.
//
// spec-planner.md section 2 `/planner`: the New event modal's Kind is
// "Event / Focus time / Out of office", "persisted on the event, not
// cosmetic". Before Phase 4 those four tabs changed one placeholder string
// and nothing else, which is the defect (audit P-3).
//
// Pure: no prisma, no React, no Next. Unit-tested.

/** The three kinds a person can create. Stored as a word, not an enum. */
export const CALENDAR_EVENT_KINDS = ["EVENT", "FOCUS", "OOO"] as const;

export type CalendarEventKindWord = (typeof CALENDAR_EVENT_KINDS)[number];

/** What each kind is called on screen. One place, so the menu, the popover
 *  and the block label never drift apart. */
export const CALENDAR_EVENT_KIND_LABEL: Readonly<Record<CalendarEventKindWord, string>> = {
  EVENT: "Event",
  FOCUS: "Focus time",
  OOO: "Out of office",
};

/**
 * Anything at all to one of the three words.
 *
 * Unknown input is an Event rather than a rejection: a row written by a
 * future release with a fourth kind still renders on today's calendar as an
 * ordinary block, which is the "every reader tolerates the shape moving"
 * rule applied to a value instead of to a column.
 */
export function normaliseEventKind(v: unknown): CalendarEventKindWord {
  if (typeof v !== "string") return "EVENT";
  const up = v.trim().toUpperCase();
  return (CALENDAR_EVENT_KINDS as readonly string[]).includes(up) ? (up as CalendarEventKindWord) : "EVENT";
}

/**
 * The end of an event, given what the caller sent.
 *
 * An all-day event ends at the last minute of its own day, so a single
 * `allDay` row never bleeds into the next column. A timed event with an end
 * at or before its start is given 30 minutes: a zero-height block on a grid
 * is a block nobody can click, and refusing the save instead would lose what
 * the person typed over an arithmetic slip.
 */
export function resolveEventEnd(startAt: Date, endAt: Date | null, allDay: boolean): Date {
  if (allDay) {
    const end = new Date(startAt.getTime());
    end.setUTCHours(end.getUTCHours() + 24);
    return new Date(end.getTime() - 60_000);
  }
  if (endAt && endAt.getTime() > startAt.getTime()) return endAt;
  return new Date(startAt.getTime() + 30 * 60_000);
}

/** A title that is only whitespace is the kind's own name, never "". */
export function resolveEventTitle(title: unknown, kind: CalendarEventKindWord): string {
  const t = typeof title === "string" ? title.trim() : "";
  return t.length ? t.slice(0, 300) : CALENDAR_EVENT_KIND_LABEL[kind];
}
