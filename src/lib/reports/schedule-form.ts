// The Schedule report dialog's pure half: the form state, the bodies it
// sends, the rebase after a 409, and every time and cadence it prints.
//
// TIMES. Every time on screen goes through src/lib/format/date.ts with the
// viewer's preferences: 12h reads "9:00 AM" (hour12 true) and 24h reads
// "09:00" (hourCycle "h23"). hour12: false is never used, because Node 20
// formats midnight as "24" under it (the production bug schedule.ts records).
// A run time is an INSTANT shown in the schedule's own zone; a time of day is
// a wall clock and is printed as digits, never re-read in a zone.
//
// RECIPIENTS ARE MEMBER IDS. The form holds ids picked from
// /api/report-schedules/recipient-options; nothing here takes an address.
//
// Pure: schedule.ts (zod only) and format/date.ts (no imports).

import { formatDate, formatWallClockHhmm, type DateFormatPrefs } from "@/lib/format/date";
import { isValidTimeZone, type ReportCadence, type ScheduleSpec } from "./schedule";

export interface ScheduleFormState {
  cadence: ReportCadence;
  /** ISO weekday, 1 Monday to 7 Sunday; weekly only. */
  weekday: number | null;
  /** 1 to 31; monthly only. */
  monthDay: number | null;
  /** "HH:mm", 24 hour. */
  timeOfDay: string;
  timezone: string;
  recipientIds: string[];
  active: boolean;
}

export const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

function uniq(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
}

/**
 * The zone a new schedule starts in: the viewer's own preference when Intl
 * accepts it, else the browser's, else UTC.
 */
export function defaultTimezone(pref?: string | null): string {
  if (pref && isValidTimeZone(pref)) return pref;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) return zone;
  } catch {
    /* fall through */
  }
  return "UTC";
}

/**
 * A new schedule: weekly on Monday at 09:00 in the viewer's zone, to the
 * viewer. A private view goes to its owner only, so that is the one
 * recipient it starts with.
 */
export function emptyScheduleForm(i: { timezone: string; viewerId: string; privateOwnerId?: string | null }): ScheduleFormState {
  return {
    cadence: "weekly",
    weekday: 1,
    monthDay: null,
    timeOfDay: "09:00",
    timezone: i.timezone,
    recipientIds: [i.privateOwnerId || i.viewerId],
    active: true,
  };
}

/** A stored schedule (the route's ScheduleDTO) as the form. */
export function formFromSchedule(dto: {
  cadence: string;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  timezone: string;
  recipients: ReadonlyArray<{ id: string }>;
  active: boolean;
}): ScheduleFormState {
  const cadence: ReportCadence = dto.cadence === "daily" || dto.cadence === "monthly" ? dto.cadence : "weekly";
  return {
    cadence,
    weekday: cadence === "weekly" ? dto.weekday ?? 1 : null,
    monthDay: cadence === "monthly" ? dto.monthDay ?? 1 : null,
    timeOfDay: dto.timeOfDay,
    timezone: dto.timezone,
    recipientIds: uniq(dto.recipients.map((r) => r.id)),
    active: dto.active,
  };
}

/** The spec the cadence helpers read, with the day the cadence does not use cleared. */
export function specFromForm(form: ScheduleFormState): ScheduleSpec {
  return {
    cadence: form.cadence,
    weekday: form.cadence === "weekly" ? form.weekday : null,
    monthDay: form.cadence === "monthly" ? form.monthDay : null,
    timeOfDay: form.timeOfDay,
    timezone: form.timezone,
  };
}

/** What stops the form from being sent, per field, as sentences. */
export function formProblems(form: ScheduleFormState): Partial<Record<"weekday" | "monthDay" | "timeOfDay" | "timezone" | "recipients", string>> {
  const out: Partial<Record<"weekday" | "monthDay" | "timeOfDay" | "timezone" | "recipients", string>> = {};
  if (form.cadence === "weekly" && !(form.weekday && form.weekday >= 1 && form.weekday <= 7)) out.weekday = "Pick a day of the week.";
  if (form.cadence === "monthly" && !(form.monthDay && form.monthDay >= 1 && form.monthDay <= 31)) out.monthDay = "Pick a day of the month.";
  if (!TIME_OF_DAY.test(form.timeOfDay)) out.timeOfDay = "Pick a time.";
  if (!isValidTimeZone(form.timezone)) out.timezone = "Pick a time zone.";
  if (form.recipientIds.length === 0) out.recipients = "Add at least one person.";
  else if (form.recipientIds.length > 100) out.recipients = "A report can go to up to 100 people.";
  return out;
}

/** The server's invalid_schedule issues, beside the fields they name. */
export function issueFields(issues: unknown): Partial<Record<"weekday" | "monthDay" | "timeOfDay" | "timezone" | "recipients" | "form", string>> {
  const out: Partial<Record<"weekday" | "monthDay" | "timeOfDay" | "timezone" | "recipients" | "form", string>> = {};
  if (!Array.isArray(issues)) return out;
  for (const raw of issues) {
    const path = raw && typeof raw === "object" ? String((raw as { path?: unknown }).path ?? "") : "";
    if (path.startsWith("weekday")) out.weekday = "Pick a day of the week.";
    else if (path.startsWith("monthDay")) out.monthDay = "Pick a day of the month.";
    else if (path.startsWith("timeOfDay")) out.timeOfDay = "Pick a time.";
    else if (path.startsWith("timezone")) out.timezone = "Pick a time zone this browser knows.";
    else if (path.startsWith("recipientUserIds")) out.recipients = "Check the people on this report.";
    else out.form = "Check the schedule and try again.";
  }
  return out;
}

export function formToCreateBody(form: ScheduleFormState, target: { kind: "dashboard" | "view"; id: string }) {
  const spec = specFromForm(form);
  return {
    targetKind: target.kind,
    targetId: target.id,
    cadence: spec.cadence,
    weekday: spec.weekday,
    monthDay: spec.monthDay,
    timeOfDay: spec.timeOfDay,
    timezone: spec.timezone,
    recipientUserIds: uniq(form.recipientIds),
    active: form.active,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

function whenChanged(a: ScheduleFormState, b: ScheduleFormState): boolean {
  const sa = specFromForm(a);
  const sb = specFromForm(b);
  return sa.cadence !== sb.cadence || sa.weekday !== sb.weekday || sa.monthDay !== sb.monthDay;
}

/**
 * An edit as a PATCH body: only what the person changed, at the version the
 * form was opened with. Leaving the recipients out when they did not change
 * is what makes a toggle of Active alone unable to re-add someone who
 * unsubscribed in the meantime.
 */
export function formToPatchBody(form: ScheduleFormState, original: ScheduleFormState & { updatedAt: string }) {
  const body: Record<string, unknown> = { expectedUpdatedAt: original.updatedAt };
  const spec = specFromForm(form);
  if (whenChanged(form, original) || form.timeOfDay !== original.timeOfDay || form.timezone !== original.timezone) {
    body.cadence = spec.cadence;
    body.weekday = spec.weekday;
    body.monthDay = spec.monthDay;
    body.timeOfDay = spec.timeOfDay;
    body.timezone = spec.timezone;
  }
  if (!sameSet(form.recipientIds, original.recipientIds)) body.recipientUserIds = uniq(form.recipientIds);
  if (form.active !== original.active) body.active = form.active;
  return body as { expectedUpdatedAt: string } & Partial<ReturnType<typeof formToCreateBody>>;
}

/**
 * After a 409: the reloaded schedule with only this person's own changes
 * applied. Recipients are the reloaded list plus the people they added minus
 * the people they removed, so someone who removed themselves in between is
 * never put back; the day (cadence, weekday and month day as one), the time,
 * the zone and Active come from the reload unless the person changed them.
 */
export function rebaseScheduleForm(form: ScheduleFormState, openedWith: ScheduleFormState, reloaded: ScheduleFormState): ScheduleFormState {
  const opened = new Set(openedWith.recipientIds);
  const now = new Set(form.recipientIds);
  const added = form.recipientIds.filter((id) => !opened.has(id));
  const removed = new Set(openedWith.recipientIds.filter((id) => !now.has(id)));
  const recipientIds = uniq([...reloaded.recipientIds, ...added]).filter((id) => !removed.has(id));
  const mineWhen = whenChanged(form, openedWith);
  return {
    cadence: mineWhen ? form.cadence : reloaded.cadence,
    weekday: mineWhen ? form.weekday : reloaded.weekday,
    monthDay: mineWhen ? form.monthDay : reloaded.monthDay,
    timeOfDay: form.timeOfDay !== openedWith.timeOfDay ? form.timeOfDay : reloaded.timeOfDay,
    timezone: form.timezone !== openedWith.timezone ? form.timezone : reloaded.timezone,
    recipientIds,
    active: form.active !== openedWith.active ? form.active : reloaded.active,
  };
}

// ── Printing ─────────────────────────────────────────────────────────

/**
 * An instant as the schedule's zone reads it, in the viewer's date order and
 * clock: "Mon 29 Sep, 9:00 AM" (12h) or "Mon 29 Sep, 09:00" (24h), with the
 * year when it is not this year. The one formatter every run time uses.
 */
export function formatRunTime(iso: string, zone: string, prefs?: DateFormatPrefs | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p: DateFormatPrefs = { ...(prefs ?? {}), timezone: isValidTimeZone(zone) ? zone : prefs?.timezone ?? "UTC" };
  return `${formatDate(d, p, "weekday")} ${formatDate(d, p, "date")}, ${formatDate(d, p, "time")}`;
}

/**
 * A zone as a person reads it: the IANA name with its underscores as spaces
 * ("America/New York"). The picker's rows and button and the cadence line
 * all print it this way, so one zone never reads two ways in one dialog.
 */
export function zoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}

/** "Every Monday at 9:00 AM (Asia/Kolkata)", with the time in the viewer's clock. */
export function cadenceLabel(spec: ScheduleSpec, prefs?: DateFormatPrefs | null): string {
  const time = formatWallClockHhmm(spec.timeOfDay, prefs) || spec.timeOfDay;
  const at = `at ${time} (${zoneLabel(spec.timezone)})`;
  if (spec.cadence === "weekly") {
    const day = WEEKDAY_OPTIONS.find((o) => o.value === spec.weekday)?.label ?? "Monday";
    return `Every ${day} ${at}`;
  }
  if (spec.cadence === "monthly") {
    const day = spec.monthDay ?? 1;
    return day >= 29 ? `Monthly on day ${day}, or a shorter month's last day, ${at}` : `Monthly on day ${day} ${at}`;
  }
  return `Every day ${at}`;
}

/**
 * The zone Intl resolves a name to, so two names for one zone compare equal
 * (Asia/Kolkata and Asia/Calcutta, US/Eastern and America/New_York). An
 * unknown name comes back as it is.
 */
export function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone || zone;
  } catch {
    return zone;
  }
}

/**
 * The time zone picker's options: what the browser supports, with UTC first
 * and the current value always present. When the browser lists the current
 * zone under another name (Asia/Calcutta for a stored Asia/Kolkata), the
 * current name takes that row's place, so the picker shows the schedule's own
 * value as selected and never lists one zone twice.
 */
export function timezoneOptions(supported: readonly string[], current: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // One row per zone: a name whose canonical zone is already listed is the
  // same zone under another name, and the first name listed wins (UTC, then
  // the schedule's own value, then the browser's list).
  const add = (z: string) => {
    const canon = canonicalZone(z);
    if (seen.has(canon)) return;
    seen.add(canon);
    out.push(z);
  };
  add("UTC");
  if (current && isValidTimeZone(current)) add(current);
  for (const z of supported) add(z);
  const [utc, ...rest] = out;
  return [utc, ...rest.sort((a, b) => a.localeCompare(b))];
}

/** What each email contains, promised in the dialog exactly as the cron builds it. */
export function reportContentLine(kind: "dashboard" | "view"): string {
  return kind === "dashboard"
    ? "Each email shows the cards the recipient can see: numbers, chart values, list rows and text."
    : "Each email shows this view's open, overdue and done counts and the next 10 tasks by due date, filtered as the view is.";
}
