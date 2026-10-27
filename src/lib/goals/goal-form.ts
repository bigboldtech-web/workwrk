// The words and rules of repeating goals on screen (docs/plans/recurring-goals.md
// A2 to A5, E1, E2, E4): the create and edit modal's Goal type block, the
// list's Due cell, the goal page's Repeats row and period lines, the row
// menu's Stop repeating and the delete confirm. One pure module, so the
// modal, the list, the goal page and their tests read the same answer.
//
// CLIENT SAFE. It reads the period engine (goal-period.ts, pure) with the
// workspace's period settings the server hands the page (GET /api/okrs
// `periodSettings`), so a Starts choice, its dates and "4 days left" are the
// workspace zone's, never the browser's. The server checks every choice
// again (goal-periods.server.ts resolveStart and planRepeatPatch).
//
// No em dashes or double hyphens in any string here.

import {
  daysLeft,
  defaultStart,
  isGoalCadence,
  lastDayKey,
  nextPeriod,
  nominalLastDayKey,
  periodDatesLabel,
  periodFor,
  periodLabel,
  planCadenceChange,
  startOfZonedDay,
  startOptions,
  type GoalCadence,
  type GoalPeriodRange,
  type GoalResult,
  type PeriodSettings,
} from "@/lib/goals/goal-period";
import { verdictChip, type GoalVerdict, type VerdictTone } from "@/lib/goal-verdict";
import { zonedDateKey } from "@/lib/zoned-time";
import { MONTH_NAMES } from "@/lib/settings/org-policy";

/* ───────────────────────── Options ───────────────────────── */

export type GoalType = "ONE_TIME" | "REPEATING";

export const GOAL_TYPE_OPTIONS: { value: GoalType; label: string }[] = [
  { value: "ONE_TIME", label: "One time" },
  { value: "REPEATING", label: "Repeating" },
];

export const REPEAT_OPTIONS: { value: GoalCadence; label: string }[] = [
  { value: "WEEKLY", label: "Week" },
  { value: "MONTHLY", label: "Month" },
  { value: "QUARTERLY", label: "Quarter" },
  { value: "YEARLY", label: "Year" },
];

/** OKR.checkInCadence: the reminder rhythm. NONE silences the reminder cron for the goal. */
export type ReminderCadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "NONE";

export function isReminderCadence(v: unknown): v is ReminderCadence {
  return v === "WEEKLY" || v === "BIWEEKLY" || v === "MONTHLY" || v === "NONE";
}

/**
 * The reminder choices (A2 item 6). With the switch on the field reads
 * "Remind the owner to check in" and its last choice is Off; with it off it
 * stays today's "Check-ins" with None. A weekly goal offers Weekly and Off:
 * the other two would never fire inside one period.
 */
export function reminderOptions(repeat: GoalCadence | null, recurringOn: boolean): { value: ReminderCadence; label: string }[] {
  const all: { value: ReminderCadence; label: string }[] = [
    { value: "WEEKLY", label: "Weekly" },
    { value: "BIWEEKLY", label: "Every two weeks" },
    { value: "MONTHLY", label: "Monthly" },
    { value: "NONE", label: recurringOn ? "Off" : "None" },
  ];
  return repeat === "WEEKLY" ? [all[0], all[3]] : all;
}

/** A reminder rhythm a weekly goal cannot hold becomes Weekly. */
export function reminderFor(repeat: GoalCadence | null, cadence: ReminderCadence): ReminderCadence {
  return repeat === "WEEKLY" && (cadence === "BIWEEKLY" || cadence === "MONTHLY") ? "WEEKLY" : cadence;
}

/* ───────────────────────── Words ───────────────────────── */

const UNIT: Record<GoalCadence, { one: string; many: string; adverb: string; every: string; thisOne: string }> = {
  WEEKLY: { one: "week", many: "weeks", adverb: "weekly", every: "Every week", thisOne: "This week" },
  MONTHLY: { one: "month", many: "months", adverb: "monthly", every: "Every month", thisOne: "This month" },
  QUARTERLY: { one: "quarter", many: "quarters", adverb: "quarterly", every: "Every quarter", thisOne: "This quarter" },
  YEARLY: { one: "year", many: "years", adverb: "yearly", every: "Every year", thisOne: "This year" },
};

/** "monthly" */
export function repeatAdverb(c: GoalCadence): string {
  return UNIT[c].adverb;
}

/** "12 months", "1 week" */
export function periodCount(c: GoalCadence, n: number): string {
  return `${n} ${n === 1 ? UNIT[c].one : UNIT[c].many}`;
}

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function partsOf(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

/** "1 Nov", or "1 Nov 2026" with the year. */
export function shortDay(key: string, withYear = false): string {
  const [y, m, d] = partsOf(key);
  return `${d} ${SHORT_MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "1 January" */
function longDay(key: string): string {
  const [, m, d] = partsOf(key);
  return `${d} ${MONTH_NAMES[m - 1]}`;
}

/** "Monday 2 November" */
function weekdayDay(key: string): string {
  const [y, m, d] = partsOf(key);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${longDay(key)}`;
}

/** A period's name without the year for a month ("October"), else its label ("Q3 FY27", "Week of 26 Oct"). */
function shortName(p: GoalPeriodRange, s: PeriodSettings, now: Date): string {
  if (p.cadence !== "MONTHLY") return periodLabel(p, s, now);
  const [, m] = partsOf(nominalLastDayKey(p, s));
  return MONTH_NAMES[m - 1];
}

/** "4 days left", "1 day left", "last day" */
export function leftWords(n: number): string {
  if (n <= 0) return "last day";
  return n === 1 ? "1 day left" : `${n} days left`;
}

/* ───────────────────────── Starts and Ends (A2, A3) ───────────────────────── */

export interface PeriodChoice {
  /** Starts: the period's key. Ends: its nominal last day (OKR.repeatUntil), "" for Never. */
  value: string;
  label: string;
  /** The second line in the list: the period's dates. */
  description: string;
}

/**
 * Starts (A2): the current period and the next 12, never a past one. The
 * current one names what is left ("October, 4 days left"); every choice
 * shows its dates, so a yearly goal reads FY27 with "1 Apr 2026 to 31 Mar
 * 2027" and the April fiscal start surprises nobody. The default is the
 * current period only while at least half of it remains, else the next.
 */
export function startChoices(cadence: GoalCadence, now: Date, s: PeriodSettings): { options: PeriodChoice[]; defaultKey: string } {
  const list = startOptions(cadence, now, s, 13);
  const options = list.map((p, i) => i === 0
    ? { value: p.key, label: `${shortName(p, s, now)}, ${leftWords(daysLeft(p, now, s))}`, description: `${UNIT[cadence].thisOne} · ${periodDatesLabel(p, s)}` }
    : { value: p.key, label: periodLabel(p, s, now), description: periodDatesLabel(p, s) });
  return { options, defaultKey: defaultStart(cadence, now, s).key };
}

/** The period a Starts key names, under today's settings (the period holding that day). */
export function periodOfKey(cadence: GoalCadence, key: string, s: PeriodSettings): GoalPeriodRange {
  return periodFor(cadence, startOfZonedDay(key, s.timezone), s);
}

const END_COUNT: Record<GoalCadence, number> = { WEEKLY: 26, MONTHLY: 24, QUARTERLY: 12, YEARLY: 5 };

/**
 * Ends (A2): Never, then periods, each "Last period: March 2027", stored as
 * that period's nominal last day. On create the list starts after Starts; in
 * edit it starts at the current period, which always finishes (A3), so the
 * Ends that Stop repeating sets is one of the choices. A saved Ends that the
 * list does not reach is kept as a choice of its own.
 */
export function endChoices(
  cadence: GoalCadence,
  from: GoalPeriodRange,
  s: PeriodSettings,
  now: Date,
  opts: { includeFrom: boolean; saved?: string | null },
): PeriodChoice[] {
  const out: PeriodChoice[] = [{ value: "", label: "Never", description: "Runs until someone stops it" }];
  let p = opts.includeFrom ? from : periodFor(cadence, from.endsAt, s);
  for (let i = 0; i < END_COUNT[cadence]; i++) {
    const last = nominalLastDayKey(p, s);
    out.push({ value: last, label: `Last period: ${periodLabel(p, s, now)}`, description: `Ends ${shortDay(last, true)}` });
    p = periodFor(cadence, p.endsAt, s);
  }
  if (opts.saved && !out.some((o) => o.value === opts.saved)) {
    const held = periodOfKey(cadence, opts.saved, s);
    out.push({ value: opts.saved, label: `Last period: ${periodLabel(held, s, now)}`, description: `Ends ${shortDay(opts.saved, true)}` });
  }
  return out;
}

/** The line under Repeats every (A2): what will happen. */
export function freshLine(cadence: GoalCadence, s: PeriodSettings): string {
  if (cadence === "WEEKLY") return `Targets start fresh every ${s.weekStart === "SUN" ? "Sunday" : "Monday"}. Past weeks keep their results.`;
  if (cadence === "MONTHLY") return "Targets start fresh on the 1st of every month. Past months keep their results.";
  if (cadence === "QUARTERLY") return "Targets start fresh every quarter. Past quarters keep their results.";
  return "Targets start fresh every year. Past years keep their results.";
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A3: what a change of Repeats every does, said before saving. The current
 * period is never cut short.
 *   coarser: "Repeats quarterly from 1 January. November and December stay monthly."
 *   finer:   "Repeats weekly from Monday 2 November. October runs to 1 November."
 * Null when the cadence is unchanged.
 */
export function cadenceChangeLine(current: GoalPeriodRange, to: GoalCadence, s: PeriodSettings, now: Date): string | null {
  if (to === current.cadence) return null;
  const change = planCadenceChange(current, to, s);
  const fromKey = zonedDateKey(change.effectiveFrom, s.timezone);
  const head = `Repeats ${UNIT[to].adverb} from ${to === "WEEKLY" ? weekdayDay(fromKey) : longDay(fromKey)}.`;
  const name = shortName(current, s, now);
  const stretched = change.currentEndsAt.getTime() !== current.endsAt.getTime();
  const runsTo = stretched ? ` ${name} runs to ${longDay(lastDayKey({ endsAt: change.currentEndsAt }, s))}.` : "";
  if (change.direction === "finer") return `${head}${runsTo}`;
  // Coarser: the old cadence runs whole periods until the new one starts.
  const middle: GoalPeriodRange[] = [];
  let prev: Pick<GoalPeriodRange, "cadence" | "endsAt"> = { cadence: current.cadence, endsAt: change.currentEndsAt };
  for (let i = 0; i < 60; i++) {
    const n = nextPeriod(prev, to, s);
    if (n.cadence === to || n.startsAt.getTime() >= change.effectiveFrom.getTime()) break;
    middle.push(n);
    prev = n;
  }
  if (middle.length === 0) return `${head}${runsTo}`;
  const stay = current.cadence !== "WEEKLY" && middle.length <= 3
    ? `${joinNames(middle.map((m) => shortName(m, s, now)))} ${middle.length === 1 ? "stays" : "stay"} ${UNIT[current.cadence].adverb}.`
    : `The next ${periodCount(current.cadence, middle.length)} ${middle.length === 1 ? "stays" : "stay"} ${UNIT[current.cadence].adverb}.`;
  return `${head}${runsTo} ${stay}`;
}

/* ───────────────────────── Saving (A2, A3) ───────────────────────── */

export interface GoalDatesForm {
  type: GoalType;
  /** One time. */
  startDate: string | null;
  endDate: string | null;
  /** Repeating. */
  repeat: GoalCadence;
  repeatStart: string | null;
  /** "" for Never. */
  repeatUntil: string;
  reminder: ReminderCadence;
  /** A3 conversion: open the current period at the start value, or count what was added since it began. */
  firstPeriodStart: "start" | "change";
}

/** What the goal held when the modal opened (edit), for sending only what changed. */
export interface SavedRepeat {
  repeat: GoalCadence | null;
  repeatUntil: string | null;
  /** The first period's key, or the Starts of a goal that has not started. */
  firstKey: string | null;
  /** Starts may still change (no period has closed and only the first has opened). */
  startsEditable: boolean;
}

/**
 * The form's date errors. A one-time goal needs a due date on or after its
 * start; a repeating goal has no due date at all, so nothing here can stop
 * it saving.
 */
export function validateGoalDates(f: Pick<GoalDatesForm, "type" | "startDate" | "endDate">): { endDate?: string } {
  if (f.type === "REPEATING") return {};
  if (!f.endDate) return { endDate: "Pick a due date." };
  if (f.startDate && f.startDate > f.endDate) return { endDate: "The due date is before the start date." };
  return {};
}

/**
 * The date and repeat part of the POST or PATCH body (section I). A
 * repeating goal never sends a due date (the server refuses one with
 * repeat). An edit sends only what changed, so an untouched save never moves
 * Starts or Ends.
 */
export function goalDatesPayload(f: GoalDatesForm, saved: SavedRepeat | null): Record<string, unknown> {
  const reminder = reminderFor(f.type === "REPEATING" ? f.repeat : null, f.reminder);
  if (f.type === "ONE_TIME") {
    return { startDate: f.startDate || null, endDate: f.endDate || null, checkInCadence: reminder, ...(saved?.repeat ? { repeat: null } : {}) };
  }
  const until = f.repeatUntil || null;
  if (!saved || !saved.repeat) {
    return {
      repeat: f.repeat,
      ...(f.repeatStart ? { repeatStart: f.repeatStart } : {}),
      repeatUntil: until,
      checkInCadence: reminder,
      ...(saved && f.firstPeriodStart === "change" ? { firstPeriodStart: "change" } : {}),
    };
  }
  const out: Record<string, unknown> = { checkInCadence: reminder };
  if (f.repeat !== saved.repeat) out.repeat = f.repeat;
  if (saved.startsEditable && f.repeatStart && f.repeatStart !== saved.firstKey) out.repeatStart = f.repeatStart;
  if ((until ?? null) !== (saved.repeatUntil ?? null)) out.repeatUntil = until;
  return out;
}

/* ───────────────────────── The migration offer (A5) ───────────────────────── */

function lastOfMonth(key: string): string {
  const [y, m] = partsOf(key);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

/**
 * A5: "Make this a monthly goal" is offered on a one-time goal whose
 * reminder rhythm is Monthly and whose start and due dates span exactly one
 * calendar month (the 1st to its last day). Never on a completed goal.
 */
export function offersMonthlyConversion(g: { repeat?: string | null; checkInCadence?: string | null; startDate?: string | null; endDate?: string | null; completedAt?: string | null }): boolean {
  if (g.repeat || g.completedAt || g.checkInCadence !== "MONTHLY" || !g.startDate || !g.endDate) return false;
  const s = g.startDate.slice(0, 10);
  const e = g.endDate.slice(0, 10);
  return s.endsWith("-01") && e === lastOfMonth(s);
}

/* ───────────────────────── Stop repeating and delete (A4) ───────────────────────── */

export interface RepeatingRowFacts {
  repeat?: string | null;
  completedAt?: string | Date | null;
  repeatUntil?: string | null;
  period?: { label: string; lastDay: string; nominalLastDay: string; resetsOn: string } | null;
  startDate?: string | Date | null;
}

/**
 * Stop repeating (A4) is offered on a running repeating goal that has a
 * period and is not already set to end with it. An ended goal restarts from
 * Edit > Ends > Never instead.
 */
export function stopRepeatingOffered(g: RepeatingRowFacts): boolean {
  if (!g.repeat || g.completedAt || !g.period) return false;
  return !(g.repeatUntil && g.repeatUntil <= g.period.nominalLastDay);
}

/**
 * The Delete goal confirm (A4): a goal with closed periods names what goes
 * ("12 months of results") and points at Stop repeating while it still runs.
 */
export function deleteGoalWords(title: string, history: { repeat: string | null | undefined; closed: number; ended: boolean } | null): string {
  const kids = "any goals that support it move up to the top level";
  if (history && isGoalCadence(history.repeat) && history.closed > 0) {
    const keep = history.ended ? "" : " To keep its history, choose Stop repeating instead.";
    return `Delete "${title}"? Its targets, check-ins and ${periodCount(history.repeat, history.closed)} of results go with it, and ${kids}.${keep} This cannot be undone.`;
  }
  return `Delete "${title}"? Its targets and check-ins go with it, and ${kids}. This can't be undone.`;
}

/* ───────────────────────── The list, Home and the profile (E1, E4) ───────────────────────── */

/**
 * The Due column of a repeating goal (E1), and Home's and the profile's due
 * line (E4): "Resets 1 Nov" while it runs, "Ends 31 Oct" in its last period,
 * "Ended 31 Oct" once stopped, "Starts 1 Nov" before its first period. Null
 * for a one-time goal (its due date shows as today).
 */
export function repeatingDueText(g: RepeatingRowFacts, fmtDay: (key: string) => string = (k) => shortDay(k)): { text: string; title: string } | null {
  if (!isGoalCadence(g.repeat)) return null;
  const how = `Repeats ${UNIT[g.repeat].adverb}.`;
  const p = g.period ?? null;
  if (g.completedAt) return { text: p ? `Ended ${fmtDay(p.lastDay)}` : "Ended", title: `${how} It has stopped.` };
  if (!p) {
    const start = g.startDate ? (typeof g.startDate === "string" ? g.startDate : g.startDate.toISOString()).slice(0, 10) : null;
    return { text: start ? `Starts ${fmtDay(start)}` : "Not started", title: how };
  }
  if (g.repeatUntil && g.repeatUntil <= p.nominalLastDay) return { text: `Ends ${fmtDay(p.lastDay)}`, title: `${how} Last period: ${p.label}.` };
  return { text: `Resets ${fmtDay(p.resetsOn)}`, title: `${how} This period: ${p.label}.` };
}

/**
 * The verdict chip, with E1's one exception: a running repeating goal at
 * 100% reads "Target hit" in the Completed tone; it has not ended.
 */
export function goalChip(verdict: GoalVerdict, g: { repeat?: string | null; completedAt?: string | Date | null }): { tone: VerdictTone; label: string } {
  if (verdict === "completed" && g.repeat && !g.completedAt) return { tone: verdictChip("completed").tone, label: "Target hit" };
  return verdictChip(verdict);
}

/* ───────────────────────── The goal page (E2) ───────────────────────── */

/** The Details strip's Repeats row: "Every month, since October 2026" or "Every month, October 2026 to March 2027". */
export function repeatsRowText(repeat: GoalCadence, startLabel: string | null, untilLabel: string | null, started: boolean): string {
  const every = UNIT[repeat].every;
  if (!startLabel) return every;
  // "Every week, since the week of 7 Sep", not "since Week of 7 Sep".
  const inLine = (l: string) => l.replace(/^Week of /, "the week of ");
  startLabel = inLine(startLabel);
  untilLabel = untilLabel ? inLine(untilLabel) : null;
  if (untilLabel) return untilLabel === startLabel ? `${every}, ${startLabel} only` : `${every}, ${startLabel} to ${untilLabel}`;
  return `${every}, ${started ? "since" : "from"} ${startLabel}`;
}

/** A closed period's result as a pale chip's tone. */
export const RESULT_TONE: Record<GoalResult, VerdictTone> = {
  HIT: "success",
  PARTLY_HIT: "warning",
  MISSED: "danger",
  NOT_MEASURED: "neutral",
};

/** "Hit, 112%" (B6: the result is decided on the clamped progress, the history shows the unclamped attainment). */
export function resultWords(resultLabel: string, attainment: number | null, result: string | null): string {
  return result === "NOT_MEASURED" || attainment == null ? resultLabel : `${resultLabel}, ${attainment}%`;
}

export interface PeriodLineFacts {
  state: "open" | "grace" | "closing" | "closed";
  /** Hand check-ins still taken (before graceEndsAt). */
  takesLateNumbers: boolean;
  kpiHeld: boolean;
  /** The last day late numbers are taken (graceEndsAt minus one day), yyyy-mm-dd. */
  graceLastDay: string;
  /** The last day KPI numbers are taken for it, yyyy-mm-dd, or null. */
  kpiLastDay: string | null;
  /** The day it closed, yyyy-mm-dd, or null. */
  closedDay: string | null;
}

/**
 * The Targets card's line for the period on screen (E2, B7): "Open for late
 * numbers until 5 Nov", "Open for KPI numbers until 30 Nov", "Closing",
 * "Closed on 6 Nov". Null for the period running now.
 */
export function periodTargetsLine(p: PeriodLineFacts, fmtDay: (key: string) => string = (k) => shortDay(k)): string | null {
  if (p.state === "open") return null;
  if (p.state === "closed") return p.closedDay ? `Closed on ${fmtDay(p.closedDay)}. Its numbers are final.` : "Closed. Its numbers are final.";
  if (p.state === "closing") return "Closing";
  if (p.takesLateNumbers) {
    const kpi = p.kpiHeld && p.kpiLastDay ? ` KPI numbers until ${fmtDay(p.kpiLastDay)}.` : "";
    return `Open for late numbers until ${fmtDay(p.graceLastDay)}.${kpi}`;
  }
  return p.kpiHeld && p.kpiLastDay ? `Open for KPI numbers until ${fmtDay(p.kpiLastDay)}.` : "Closing";
}
