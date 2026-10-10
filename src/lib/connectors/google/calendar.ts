// The person's Google Calendar as the calendar tools read and write it
// (docs/plans/ai-teammates-phase3.md step 4). Pure: Google's event JSON in,
// the facts the tools and the cards use out, and the times both ways.
//
// TIMES ARE THE PERSON'S, AND FIXED AS MOMENTS AT ONCE. A day or a wall-clock
// time the model writes is read on the clock of the person's zone (the one
// they chose, else their Google Calendar's: connector-access.ts
// calendarZoneFor, review of step 4) and turned into one moment when the call
// is first prepared.
// The card, the stored input and Google all carry that moment, never the
// words, so a zone changed in settings between a card and its approval moves
// nothing the person approved. The wall clock is free-time.ts's (Intl with
// hourCycle "h23", never hour12, which prints midnight as "24" on some
// runtimes).
//
// AN ALL-DAY EVENT'S END IS ITS LAST DAY. People say "Monday to Friday";
// Google's end date is the day after. So `end` here is the last day, in what
// the model writes and in what list_events tells it, and Google's exclusive
// end is made only where Google is called (googleTimes), and read back only
// where Google answers (eventFacts). A model that reads an event and writes
// its days back moves nothing by a day.
//
// WHAT GOOGLE SENT IS OTHER PEOPLE'S WORDS. eventFacts keeps titles, places,
// descriptions and names as text for the tools to cut and the cards to quote;
// nothing here decides anything from them. Whether the person organizes an
// event, or is invited to it, is read from Google's own flags (organizer.self,
// attendees[].self), never from an address someone could write.

import { createHash } from "node:crypto";
import { isZone, momentOf, startOfDay, wallClock } from "../free-time";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const iso = (ms: number) => new Date(ms).toISOString();

/** A zone Intl knows, else UTC: every reader below needs one. */
function zoneOr(zone: string): string {
  return isZone(zone) ? zone : "UTC";
}

/** An address under Google Calendar's base (config.ts calendarBase), with its query. */
export function calendarUrl(base: string, path: string, params: Array<[string, string]> = []): string {
  const q = new URLSearchParams(params).toString();
  return `${base}/${path}${q ? `?${q}` : ""}`;
}

/** The person's own primary calendar's events: the only calendar the tools read or write. */
export const PRIMARY_EVENTS = "calendars/primary/events";

/** One event of the person's primary calendar, its id a single path part whatever it holds. */
export function eventPath(id: string): string {
  return `${PRIMARY_EVENTS}/${encodeURIComponent(id)}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

/** A real day "YYYY-MM-DD" from its parts, 1970 to 2200, never the 30th of February. */
function checkedDay(y: number, mo: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1970 || y > 2200) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

/** A real day written "YYYY-MM-DD", or null. */
export function realDay(s: unknown): string | null {
  const m = DAY_RE.exec(String(s ?? "").trim());
  return m ? checkedDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** The day `n` days after `day` (before, when `n` is negative). */
export function addDays(day: string, n: number): string {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: 0 for the same day, negative when `to` comes first. */
export function daysBetween(from: string, to: string): number {
  const at = (s: string) => {
    const [y, mo, d] = s.split("-").map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  return Math.round((at(to) - at(from)) / DAY_MS);
}

/** The weekday of a day, 0 for Sunday, as Date.getDay counts them. */
export function weekdayOf(day: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/**
 * The moment `day` starts on the clock of `zone`: its first moment, even
 * where a daylight saving change skips its midnight (free-time.ts startOfDay,
 * review of step 4).
 */
export function dayStart(day: string, zone: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  return startOfDay(y, mo, d, zoneOr(zone));
}

/** A moment's day and time on the clock of `zone`: "2026-10-13" and "10:00". */
export function wallOf(at: number, zone: string): { day: string; time: string } {
  const w = wallClock(at, zoneOr(zone));
  return { day: `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}` };
}

/** A moment as the tools write it for the model: "2026-10-13T10:00" on the person's clock. */
export function localStamp(at: number, zone: string): string {
  const w = wallOf(at, zone);
  return `${w.day}T${w.time}`;
}

/**
 * The day a model's "from" or "to" names: "2026-10-13", or the day of
 * "2026-10-13T10:00" (a time the model wrote is on the person's clock, so its
 * first ten characters are that day there). Null for anything else.
 */
export function dayPart(s: unknown): string | null {
  const t = String(s ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(t) ? realDay(t.slice(0, 10)) : null;
}

/** A start or an end as the model wrote it: a day, or a moment. */
export type When = { kind: "day"; day: string } | { kind: "time"; at: number };

/**
 * A start or an end as the model writes it: "YYYY-MM-DD" for all day, or
 * "YYYY-MM-DDTHH:MM" (seconds allowed and dropped) on the clock of `zone`.
 * Null for any other shape, or a zone Intl does not know.
 */
export function readWhen(s: unknown, zone: string): When | null {
  const t = String(s ?? "").trim();
  const day = realDay(t);
  if (day) return { kind: "day", day };
  const m = TIME_RE.exec(t);
  if (!m || !isZone(zone)) return null;
  const d = checkedDay(Number(m[1]), Number(m[2]), Number(m[3]));
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  if (!d || h > 23 || mi > 59 || sec > 59) return null;
  return { kind: "time", at: momentOf(Number(m[1]), Number(m[2]), Number(m[3]), h, mi, zone) };
}

/**
 * One event's times. A day event: its first and last day, both its own
 * (Google's end, the day after, is made in googleTimes). A timed event: two
 * moments, UTC, and the zone they were given in, which Google keeps with
 * them.
 */
export type EventTimes = { kind: "time"; start: string; end: string; zone: string } | { kind: "day"; start: string; end: string };

/**
 * A start and an end as one event's times: both days, the last on or after
 * the first, or both moments, the end after the start. "mixed" for a day and
 * a time; "order" for an end that does not come after the start.
 */
export function eventTimes(start: When, end: When, zone: string): EventTimes | "mixed" | "order" {
  if (start.kind === "day" && end.kind === "day") return daysBetween(start.day, end.day) < 0 ? "order" : { kind: "day", start: start.day, end: end.day };
  if (start.kind === "time" && end.kind === "time") return end.at <= start.at ? "order" : { kind: "time", start: iso(start.at), end: iso(end.at), zone: zoneOr(zone) };
  return "mixed";
}

/**
 * An event's new times when a change names only some of them: both given,
 * as they are; only a start, the event moved and its length kept; only an
 * end, the start kept. "unknown" when the event's own times can't be read
 * and only one side was given.
 */
export function changedTimes(now: EventTimes | null, start: When | null, end: When | null, zone: string): EventTimes | "mixed" | "order" | "unknown" {
  if (start && end) return eventTimes(start, end, zone);
  if (!now || (!start && !end)) return "unknown";
  if (start) {
    if (start.kind === "day") return now.kind === "day" ? { kind: "day", start: start.day, end: addDays(start.day, daysBetween(now.start, now.end)) } : "mixed";
    if (now.kind !== "time") return "mixed";
    const length = Date.parse(now.end) - Date.parse(now.start);
    return { kind: "time", start: iso(start.at), end: iso(start.at + length), zone: zoneOr(zone) };
  }
  const from: When = now.kind === "day" ? { kind: "day", day: now.start } : { kind: "time", at: Date.parse(now.start) };
  return eventTimes(from, end as When, zone);
}

/** Whether two events' times are the same days, or the same two moments. */
export function sameTimes(a: EventTimes | null, b: EventTimes | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "day") return a.start === b.start && a.end === b.end;
  return Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
}

/**
 * Times a card stored (its input), read back: null for anything this file did
 * not write. A timed event may have no length (its start and its end the same
 * moment): Google allows one, and a move of it keeps its length (review of
 * step 4); a new event's end still comes after its start (eventTimes).
 */
export function storedTimes(v: unknown): EventTimes | null {
  const r = rec(v);
  if (r.kind === "day") {
    const s = realDay(r.start);
    const e = realDay(r.end);
    return s && e && daysBetween(s, e) >= 0 ? { kind: "day", start: s, end: e } : null;
  }
  if (r.kind === "time") {
    const s = Date.parse(str(r.start));
    const e = Date.parse(str(r.end));
    const zone = str(r.zone);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s || !isZone(zone)) return null;
    return { kind: "time", start: iso(s), end: iso(e), zone };
  }
  return null;
}

/** The times as a new event carries them: an all-day event's end is the day after its last, as Google counts it. */
export function googleTimes(t: EventTimes): { start: Record<string, string>; end: Record<string, string> } {
  return t.kind === "day"
    ? { start: { date: t.start }, end: { date: addDays(t.end, 1) } }
    : { start: { dateTime: t.start, timeZone: t.zone }, end: { dateTime: t.end, timeZone: t.zone } };
}

/**
 * The same for a change. Google merges the objects of a PATCH, so the other
 * kind's fields are cleared: a timed event can become an all-day one and
 * back, never carry both.
 */
export function googlePatchTimes(t: EventTimes): { start: Record<string, string | null>; end: Record<string, string | null> } {
  const g = googleTimes(t);
  return t.kind === "day"
    ? { start: { ...g.start, dateTime: null, timeZone: null }, end: { ...g.end, dateTime: null, timeZone: null } }
    : { start: { ...g.start, date: null }, end: { ...g.end, date: null } };
}

/** The times as the model reads them: moments on the person's clock, or days (the end the last day). */
export function timesForModel(t: EventTimes, zone: string): { start: string; end: string; allDay: boolean } {
  if (t.kind === "day") return { start: t.start, end: t.end, allDay: true };
  return { start: localStamp(Date.parse(t.start), zone), end: localStamp(Date.parse(t.end), zone), allDay: false };
}

/**
 * An event's times as Google sent them, or null when they can't be read. An
 * event with no length (its end its start, which Google allows) reads with
 * its times: without them list_events showed none, and a move of it was
 * refused as a bad time (review of step 4).
 */
function timesOf(start: unknown, end: unknown, zone: string): EventTimes | null {
  const s = rec(start);
  const e = rec(end);
  const sd = realDay(s.date);
  const ed = realDay(e.date);
  if (sd && ed) {
    // Google's end is the day after the last; one that is not after the start is read as one day.
    const last = addDays(ed, -1);
    return { kind: "day", start: sd, end: daysBetween(sd, last) >= 0 ? last : sd };
  }
  const st = Date.parse(str(s.dateTime));
  const et = Date.parse(str(e.dateTime));
  if (!Number.isFinite(st) || !Number.isFinite(et) || et < st) return null;
  const own = str(s.timeZone);
  return { kind: "time", start: iso(st), end: iso(et), zone: own && isZone(own) ? own : zoneOr(zone) };
}

/** One person on an event, as Google lists them. */
export interface EventPerson {
  name: string | null;
  email: string;
  /** Google's own flag: this is the person whose calendar it is. */
  self: boolean;
  organizer: boolean;
  /** A room or a resource, not a person; still told of a change. */
  resource: boolean;
  /** needsAction, declined, tentative or accepted, as Google says it. */
  response: string | null;
}

/** An event as the tools and the cards read it. */
export interface EventFacts {
  id: string;
  etag: string | null;
  /** confirmed, tentative or cancelled. */
  status: string;
  title: string;
  location: string;
  description: string;
  /** Null when Google sent no start and end this file can read. */
  times: EventTimes | null;
  organizer: { name: string | null; email: string; self: boolean } | null;
  attendees: EventPerson[];
  /** Google left some of the people out of the list. */
  attendeesOmitted: boolean;
  /** One time of a repeating event (it has a recurringEventId). */
  instance: boolean;
  /** A repeating event as a whole: a change to it changes every time (it has a recurrence). */
  series: boolean;
  /** The people as a change sends them back: each one's writable fields only (Google replaces a PATCH's lists whole). */
  writableAttendees: Array<Record<string, unknown>>;
}

/** The fields of a person on an event that a change may send back to Google. */
const WRITABLE_ATTENDEE = ["email", "displayName", "optional", "responseStatus", "comment", "additionalGuests", "resource"] as const;

function writableAttendee(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE_ATTENDEE) {
    const v = a[k];
    if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/** An address Google wrote for a person on an event: text with no space in it. */
function plainAddress(v: unknown): string {
  const s = str(v).trim();
  return s.length > 0 && s.length <= 320 && !/\s/.test(s) ? s : "";
}

/** An event as Google sent it, read defensively; null when it has no id. Times not given in a zone of their own read in `zone`. */
export function eventFacts(raw: unknown, zone: string): EventFacts | null {
  const e = rec(raw);
  const id = str(e.id).trim();
  if (!id || id.length > 1024) return null;
  const org = rec(e.organizer);
  const organizerEmail = plainAddress(org.email);
  const people = (Array.isArray(e.attendees) ? e.attendees : []).map(rec).filter((a) => plainAddress(a.email));
  return {
    id,
    etag: str(e.etag) || null,
    status: str(e.status) || "confirmed",
    title: str(e.summary),
    location: str(e.location),
    description: str(e.description),
    times: timesOf(e.start, e.end, zone),
    organizer: organizerEmail || org.self === true ? { name: str(org.displayName) || null, email: organizerEmail, self: org.self === true } : null,
    attendees: people.map((a) => ({
      name: str(a.displayName) || null,
      email: plainAddress(a.email),
      self: a.self === true,
      organizer: a.organizer === true,
      resource: a.resource === true,
      response: str(a.responseStatus) || null,
    })),
    attendeesOmitted: e.attendeesOmitted === true,
    instance: str(e.recurringEventId).length > 0,
    series: Array.isArray(e.recurrence) && e.recurrence.length > 0,
    writableAttendees: people.map(writableAttendee),
  };
}

/** Whether this person on the event is the one whose calendar it is: Google's flag, or the connected account's own address. */
export function isSelf(p: Pick<EventPerson, "self" | "email">, accountEmail: string): boolean {
  return p.self || p.email.toLowerCase() === accountEmail.toLowerCase();
}

/**
 * The event's own list with who is added and less who is taken off, as a
 * change sends it back (Google replaces a PATCH's list whole). Built from the
 * event as read at the approval, never kept on the card: a card keeps only
 * who it adds and takes off (Decision 16, review of step 4). Addresses are
 * matched in lower case; someone already on it is not added twice.
 */
export function attendeesAfter(ev: Pick<EventFacts, "writableAttendees">, adds: readonly string[], removes: readonly string[]): Array<Record<string, unknown>> {
  const lower = (v: unknown) => str(v).trim().toLowerCase();
  const gone = new Set(removes.map(lower));
  const kept = ev.writableAttendees.filter((a) => !gone.has(lower(a.email)));
  const on = new Set(kept.map((a) => lower(a.email)));
  const added = [...new Set(adds.map(lower))].filter((a) => a && !on.has(a) && !gone.has(a)).map((email) => ({ email }));
  return [...kept, ...added];
}

/**
 * The zone of the person's own Google Calendar, from an events read of it
 * (its top-level timeZone): what the calendar tools read days and times in
 * when the person never saved a zone of their own (review of step 4). Null
 * for anything Intl does not know.
 */
export function calendarZoneOf(raw: unknown): string | null {
  const z = str(rec(raw).timeZone).trim();
  return z && z.length <= 100 && isZone(z) ? z : null;
}

/** What the zone read asks Google for: one event at most, and of the answer only its zone. */
export const ZONE_READ_PARAMS: Array<[string, string]> = [
  ["maxResults", "1"],
  ["fields", "timeZone"],
];

/**
 * The same invitation, whoever asked for it (review of step 4, as Decision
 * 23 is for an email): a sha256 of the people invited (lower case, each
 * once, sorted), the exact title, the times as the card fixed them and the
 * Google account. Two identical invitations waiting at once share it, so a
 * second points at the first card and nobody is invited twice.
 */
export function eventDedupeKey(e: { attendees: readonly string[]; title: string; times: EventTimes; accountSub: string }): string {
  const people = [...new Set((e.attendees ?? []).map((a) => String(a).trim().toLowerCase()).filter(Boolean))].sort();
  const times = e.times.kind === "day" ? ["day", e.times.start, e.times.end] : ["time", e.times.start, e.times.end, e.times.zone];
  return createHash("sha256")
    .update(JSON.stringify([people, String(e.title ?? ""), times, String(e.accountSub ?? "")]))
    .digest("hex");
}

/**
 * Google's free/busy answer for these calendar ids: everyone's busy blocks
 * together (no titles: free/busy carries none), and whose calendar Google
 * read and whose it could not (one not shared, or not found, answers errors).
 */
export function busyBlocks(raw: unknown, ids: readonly string[]): { busy: Array<{ start: number; end: number }>; read: string[]; unread: string[] } {
  const calendars = rec(rec(raw).calendars);
  const busy: Array<{ start: number; end: number }> = [];
  const read: string[] = [];
  const unread: string[] = [];
  for (const id of ids) {
    const own = Object.prototype.hasOwnProperty.call(calendars, id) ? rec(calendars[id]) : null;
    if (!own || (Array.isArray(own.errors) && own.errors.length > 0)) {
      unread.push(id);
      continue;
    }
    read.push(id);
    for (const b of Array.isArray(own.busy) ? own.busy : []) {
      const s = Date.parse(str(rec(b).start));
      const en = Date.parse(str(rec(b).end));
      if (Number.isFinite(s) && Number.isFinite(en) && en > s) busy.push({ start: s, end: en });
    }
  }
  return { busy, read, unread };
}
