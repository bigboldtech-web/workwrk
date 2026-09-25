// Scheduled email reports (gap 16): the pure half.
//
// A schedule emails a dashboard or a saved view on a cadence (daily, weekly on
// a weekday, monthly on a day of the month) at a time of day in an IANA zone,
// to org members. This file is the input rules, the next due instant, the run
// log and the email body. The routes and the cron are
// src/lib/reports/report-server.ts and the report-schedules API.
//
// TIMEZONES. Every wall-clock reading goes through Intl with hourCycle "h23",
// NEVER hour12: false. This repo shipped a production bug where Node 20
// formatted midnight as "24" under hour12: false and wrote every date a day
// early; "h23" is the option that means 00 to 23 on every runtime.
//
// RECIPIENTS ARE MEMBER IDS. There is no field an email address can go in,
// because a free-text recipient on a report is an exfiltration door: the
// report is computed under a member's access and then mailed wherever the
// sender typed.
//
// Pure: zod only.

import { z } from "zod";

export const REPORT_TARGET_KINDS = ["dashboard", "view"] as const;
export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number];
export const REPORT_CADENCES = ["daily", "weekly", "monthly"] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];
export const MAX_REPORT_RECIPIENTS = 100;
export const RUN_LOG_LIMIT = 20;

export interface ScheduleSpec {
  cadence: ReportCadence;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string;
  timezone: string;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A zone Intl accepts. Checked at write time so the cron never meets a bad one. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // h23, never hour12: false. See the header.
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall clock in `tz` at `instant`. */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(instant)) {
    if (p.type === "year" || p.type === "month" || p.type === "day" || p.type === "hour" || p.type === "minute" || p.type === "second") {
      out[p.type] = Number(p.value);
    }
  }
  // h23 answers 0 to 23. The modulo is a belt for a runtime that ever answers
  // 24 for midnight anyway: 24 is midnight of the SAME day, and treating it
  // as the next day is exactly the bug the header names.
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

function offsetMs(instantMs: number, tz: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const p = zonedParts(new Date(whole), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/**
 * The instant at which the wall clock in `tz` reads y-m-d H:M.
 *
 * Two passes, because the offset at the guess and the offset at the answer
 * differ across a DST change. A wall-clock time that does not exist that day
 * (a spring-forward gap) lands just after the gap, which is when a person in
 * that zone would expect it.
 */
export function zonedTimeToUtc(y: number, m: number, d: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz));
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The next due instant strictly after `now`, or null for a spec that can
 * never run. A monthly day past the end of a short month runs on its last
 * day, so "the 31st" means every month's last day where it has no 31st.
 */
export function nextReportRunAt(spec: ScheduleSpec, now: Date): Date | null {
  if (!isValidTimeZone(spec.timezone) || !TIME_OF_DAY.test(spec.timeOfDay)) return null;
  if (spec.cadence === "weekly" && !(spec.weekday && spec.weekday >= 1 && spec.weekday <= 7)) return null;
  if (spec.cadence === "monthly" && !(spec.monthDay && spec.monthDay >= 1 && spec.monthDay <= 31)) return null;
  const [hour, minute] = spec.timeOfDay.split(":").map(Number);
  const today = zonedParts(now, spec.timezone);
  for (let i = 0; i <= 62; i += 1) {
    // A calendar date carried in a UTC timestamp: only its y-m-d and weekday
    // are read, never its time.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1;
    if (spec.cadence === "weekly" && isoWeekday !== spec.weekday) continue;
    if (spec.cadence === "monthly" && d !== Math.min(spec.monthDay as number, daysInMonth(y, m))) continue;
    const at = zonedTimeToUtc(y, m, d, hour, minute, spec.timezone);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** How the cadence reads in the UI and in the email footer. */
export function cadenceText(spec: ScheduleSpec): string {
  const at = `at ${spec.timeOfDay} (${spec.timezone})`;
  if (spec.cadence === "weekly") return `Every ${WEEKDAY_NAMES[(spec.weekday ?? 1) - 1] ?? "Monday"} ${at}`;
  if (spec.cadence === "monthly") {
    const day = spec.monthDay ?? 1;
    return day >= 29 ? `Monthly on day ${day}, or the last day of a shorter month, ${at}` : `Monthly on day ${day} ${at}`;
  }
  return `Every day ${at}`;
}

// ── Input ────────────────────────────────────────────────────────────

const idSchema = z.string().trim().min(1).max(64);

const createSchema = z
  .object({
    targetKind: z.enum(REPORT_TARGET_KINDS),
    targetId: idSchema,
    cadence: z.enum(REPORT_CADENCES),
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    monthDay: z.number().int().min(1).max(31).nullable().optional(),
    timeOfDay: z.string().regex(TIME_OF_DAY),
    timezone: z.string().min(1).max(64),
    recipientUserIds: z.array(idSchema).min(1).max(MAX_REPORT_RECIPIENTS),
    active: z.boolean().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime(),
    cadence: z.enum(REPORT_CADENCES).optional(),
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    monthDay: z.number().int().min(1).max(31).nullable().optional(),
    timeOfDay: z.string().regex(TIME_OF_DAY).optional(),
    timezone: z.string().min(1).max(64).optional(),
    recipientUserIds: z.array(idSchema).min(1).max(MAX_REPORT_RECIPIENTS).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export interface ScheduleIssue {
  path: string;
  message: string;
}

export interface ValidSchedule extends ScheduleSpec {
  targetKind: ReportTargetKind;
  targetId: string;
  recipientUserIds: string[];
  active: boolean;
}

function crossCheck(spec: ScheduleSpec, recipients: readonly string[] | null): { spec: ScheduleSpec; issues: ScheduleIssue[] } {
  const issues: ScheduleIssue[] = [];
  if (!isValidTimeZone(spec.timezone)) issues.push({ path: "timezone", message: "not an IANA time zone" });
  let weekday = spec.weekday ?? null;
  let monthDay = spec.monthDay ?? null;
  if (spec.cadence === "weekly") {
    if (!weekday) issues.push({ path: "weekday", message: "a weekly report needs a weekday" });
    monthDay = null;
  } else if (spec.cadence === "monthly") {
    if (!monthDay) issues.push({ path: "monthDay", message: "a monthly report needs a day of the month" });
    weekday = null;
  } else {
    weekday = null;
    monthDay = null;
  }
  if (recipients && recipients.some((r) => r.includes("@"))) {
    issues.push({ path: "recipientUserIds", message: "recipients are members, not email addresses" });
  }
  return { spec: { ...spec, weekday, monthDay }, issues };
}

/** A new schedule's body, fully checked. */
export function validateScheduleInput(input: unknown): { ok: true; value: ValidSchedule } | { ok: false; issues: ScheduleIssue[] } {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const d = parsed.data;
  const recipients = Array.from(new Set(d.recipientUserIds));
  const { spec, issues } = crossCheck(
    { cadence: d.cadence, weekday: d.weekday ?? null, monthDay: d.monthDay ?? null, timeOfDay: d.timeOfDay, timezone: d.timezone },
    recipients,
  );
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { ...spec, targetKind: d.targetKind, targetId: d.targetId, recipientUserIds: recipients, active: d.active ?? true } };
}

export type SchedulePatch = z.infer<typeof patchSchema>;

/**
 * A schedule edit, merged over the stored schedule and checked as a whole.
 * `timingChanged` says whether the next due instant must be recomputed.
 */
export function validateSchedulePatch(
  stored: ScheduleSpec & { recipientUserIds: string[]; active: boolean },
  input: unknown,
):
  | { ok: true; patch: SchedulePatch; spec: ScheduleSpec; recipientUserIds: string[]; active: boolean; timingChanged: boolean }
  | { ok: false; error: "target_immutable" | "version_required" | "invalid_schedule"; issues?: ScheduleIssue[] } {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if ("targetKind" in raw || "targetId" in raw) return { ok: false, error: "target_immutable" };
  if (typeof raw.expectedUpdatedAt !== "string") return { ok: false, error: "version_required" };
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid_schedule", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const p = parsed.data;
  const merged: ScheduleSpec = {
    cadence: p.cadence ?? stored.cadence,
    weekday: p.weekday !== undefined ? p.weekday : stored.weekday,
    monthDay: p.monthDay !== undefined ? p.monthDay : stored.monthDay,
    timeOfDay: p.timeOfDay ?? stored.timeOfDay,
    timezone: p.timezone ?? stored.timezone,
  };
  const recipients = p.recipientUserIds ? Array.from(new Set(p.recipientUserIds)) : stored.recipientUserIds;
  const { spec, issues } = crossCheck(merged, p.recipientUserIds ? recipients : null);
  if (issues.length) return { ok: false, error: "invalid_schedule", issues };
  const timingChanged =
    spec.cadence !== stored.cadence ||
    spec.weekday !== stored.weekday ||
    spec.monthDay !== stored.monthDay ||
    spec.timeOfDay !== stored.timeOfDay ||
    spec.timezone !== stored.timezone;
  return { ok: true, patch: p, spec, recipientUserIds: recipients, active: p.active ?? stored.active, timingChanged };
}

/**
 * The ids in a recipient list that are not live members of THIS org. The
 * route answers any non-empty result with one error and never echoes the
 * ids, so the endpoint cannot be used to test who exists.
 */
export function recipientProblems(
  requested: readonly string[],
  rows: ReadonlyArray<{ id: string; organizationId: string; deletedAt: Date | string | null; status: string | null }>,
  organizationId: string,
): string[] {
  const ok = new Set(
    rows.filter((r) => r.organizationId === organizationId && !r.deletedAt && r.status !== "INACTIVE").map((r) => r.id),
  );
  return Array.from(new Set(requested)).filter((id) => !ok.has(id));
}

/**
 * recipientProblems for a REPORT, which also refuses a Guest.
 *
 * A report carries card titles, notes text and task titles computed under
 * the recipient's access, and links back into pages a Guest is shown a 404
 * for, so a Guest is never an eligible recipient (the cron skips one too).
 * `guest` is the org role read from the member's row (orgRoleOf, in
 * list-links-server.ts recipientRows), never the raw access level.
 * recipientProblems itself is unchanged because PATCH /api/boards/[id] uses
 * it for default assignees, where a Guest is a valid assignee.
 */
export function reportRecipientProblems(
  requested: readonly string[],
  rows: ReadonlyArray<{ id: string; organizationId: string; deletedAt: Date | string | null; status: string | null; guest: boolean }>,
  organizationId: string,
): string[] {
  const guests = new Set(rows.filter((r) => r.guest).map((r) => r.id));
  const problems = new Set(recipientProblems(requested, rows, organizationId));
  for (const id of new Set(requested)) if (guests.has(id)) problems.add(id);
  return Array.from(new Set(requested)).filter((id) => problems.has(id));
}

// ── The run log ──────────────────────────────────────────────────────

export type RunOutcome = "sent" | "nothing_sent" | "target_unavailable" | "deactivated";

export interface RunLogEntry {
  dueAt: string;
  ranAt: string;
  outcome: RunOutcome;
  sent: number;
  skippedNoAccess: number;
  skippedInactive: number;
}

/** The stored log, read defensively. Counts only: an entry can never hold an id. */
export function parseRunLog(raw: unknown): RunLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RunLogEntry[] = [];
  const outcomes = new Set<string>(["sent", "nothing_sent", "target_unavailable", "deactivated"]);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.dueAt !== "string" || typeof r.ranAt !== "string" || typeof r.outcome !== "string" || !outcomes.has(r.outcome)) continue;
    out.push({ dueAt: r.dueAt, ranAt: r.ranAt, outcome: r.outcome as RunOutcome, sent: n(r.sent), skippedNoAccess: n(r.skippedNoAccess), skippedInactive: n(r.skippedInactive) });
    if (out.length >= RUN_LOG_LIMIT) break;
  }
  return out;
}

/**
 * A run as a person looking at the schedule is shown it.
 *
 * The per-run counts are how many recipients were sent a copy and how many
 * were skipped for having no access or no longer being active. With one
 * recipient (or one colleague among recipients the creator controls) those
 * numbers ARE that colleague's access: create a schedule of a List's view to
 * X alone, wait a day, read the log, and you know whether X can read the
 * List. So only an org Owner or Admin, who can see every member's access
 * anyway, is shown them. Everyone else sees that a run happened and the
 * target-level outcomes, which depend on the target and not on any person:
 * "ran" (whether or not anyone could be sent a copy), "target_unavailable"
 * and "deactivated".
 */
export type RunLogView =
  | RunLogEntry
  | { dueAt: string; ranAt: string; outcome: "ran" | "target_unavailable" | "deactivated" };

export function runLogForViewer(entries: readonly RunLogEntry[], opts: { admin: boolean }): RunLogView[] {
  if (opts.admin) return entries.map((e) => ({ ...e }));
  return entries.map((e) => ({
    dueAt: e.dueAt,
    ranAt: e.ranAt,
    outcome: e.outcome === "sent" || e.outcome === "nothing_sent" ? "ran" : e.outcome,
  }));
}

/** Newest first, the last twenty. */
export function appendRunLog(raw: unknown, entry: RunLogEntry): RunLogEntry[] {
  return [entry, ...parseRunLog(raw)].slice(0, RUN_LOG_LIMIT);
}

// ── The email ────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface ReportSection {
  heading: string;
  lines: string[];
}

/**
 * A summary and a link back, no attachments. Everything in it was computed
 * for the one recipient it goes to, so the body is safe to render as it is;
 * every string is escaped anyway, because a task title is user input.
 */
export function buildReportEmail(r: {
  title: string;
  kindLabel: string;
  cadence: string;
  sections: readonly ReportSection[];
  link: string;
}): { subject: string; html: string } {
  const subject = `${r.kindLabel} report: ${r.title}`.slice(0, 200);
  const sections = r.sections.length
    ? r.sections
        .map((s) => `<h3 style="margin:16px 0 4px;font-size:14px">${escapeHtml(s.heading)}</h3>` +
          (s.lines.length
            ? `<ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
            : `<p style="margin:0;color:#667085">Nothing to show.</p>`))
        .join("")
    : `<p style="color:#667085">There is nothing in this report to summarise right now.</p>`;
  const html =
    `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#101828">` +
    `<h2 style="font-size:16px;margin:0 0 8px">${escapeHtml(r.title)}</h2>` +
    sections +
    `<p style="margin:20px 0 0"><a href="${escapeHtml(r.link)}">Open it in WorkwrK</a></p>` +
    `<p style="margin:12px 0 0;color:#667085;font-size:12px">${escapeHtml(r.cadence)}. You receive this because you are on its recipient list; you can remove yourself from the report's page.</p>` +
    `</div>`;
  return { subject, html };
}

// ── Degrading while the table is absent ─────────────────────────────

/** The report twin of isMissingListLinkTableError, for ReportSchedule. */
export function isMissingReportTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (e.name === "PrismaClientValidationError") return /\b(reportSchedule|reportSchedules|ReportSchedule)\b/.test(message);
  let extra = "";
  try {
    extra = JSON.stringify(e.meta ?? "") + JSON.stringify(e.cause ?? "");
  } catch {
    extra = "";
  }
  const text = `${message} ${extra}`;
  const code = typeof e.code === "string" ? e.code : "";
  const metaCode = e.meta && typeof e.meta === "object" ? (e.meta as { code?: unknown }).code : undefined;
  const missing = code === "P2021" || code === "42P01" || metaCode === "42P01" || /\b42P01\b/.test(text) || /does not exist/i.test(text);
  return missing && /ReportSchedule/.test(text);
}
