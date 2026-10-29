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
  firstBoundaryOnOrAfter,
  isGoalCadence,
  lastDayKey,
  nextPeriod,
  nominalLastDayKey,
  periodDatesLabel,
  periodFor,
  periodLabel,
  planCadenceChange,
  RESULT_LABEL,
  resultFor,
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
 * current period only while at least half of it remains, else the next. A
 * CONVERSION (a one-time goal made repeating) defaults to the current
 * period whatever is left (final review M2): the goal is already running
 * this month, so starting it next month would leave this month's work
 * counted nowhere.
 */
export function startChoices(cadence: GoalCadence, now: Date, s: PeriodSettings, opts: { conversion?: boolean } = {}): { options: PeriodChoice[]; defaultKey: string } {
  const list = startOptions(cadence, now, s, 13);
  const options = list.map((p, i) => i === 0
    ? { value: p.key, label: `${shortName(p, s, now)}, ${leftWords(daysLeft(p, now, s))}`, description: `${UNIT[cadence].thisOne} · ${periodDatesLabel(p, s)}` }
    : { value: p.key, label: periodLabel(p, s, now), description: periodDatesLabel(p, s) });
  return { options, defaultKey: opts.conversion ? list[0].key : defaultStart(cadence, now, s).key };
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

/**
 * A3 for a repeating goal that has not started: a change of Repeats every
 * moves Starts to the new cadence's first boundary on or after it (as the
 * server does, planRepeatPatch). Returns the new first period, and the line
 * that says so ("Repeats quarterly from 1 January.").
 */
export function notStartedCadenceChange(firstKey: string, to: GoalCadence, s: PeriodSettings): { key: string; line: string } {
  const at = startOfZonedDay(firstKey, s.timezone);
  const key = periodFor(to, firstBoundaryOnOrAfter(to, at, s), s).key;
  return { key, line: `Repeats ${UNIT[to].adverb} from ${to === "WEEKLY" ? weekdayDay(key) : longDay(key)}.` };
}

/** M3 (step 3 review): a change of Repeats every keeps Ends in edit (Stop repeating included); a new goal's Ends goes back to Never. */
export function untilAfterCadenceChange(isEdit: boolean, until: string): string {
  return isEdit ? until : "";
}

const n2 = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/**
 * A3's count line under "October starts at" (final review L18): "What was
 * added since 1 Oct: 2 (5 now, 3 on 30 Sep)", or for a target added after
 * the period began, "What was added since 1 Oct: 6 (6 now, 0 when it was
 * added on 1 Oct)". With several targets each line is named: "Demos: 2
 * added since 1 Oct (5 now, 3 on 30 Sep)".
 */
export function conversionCountLine(
  startDay: string,
  t: { title: string; now: number; atStart: number; atStartDay: string | null; addedDay: string | null },
  named: boolean,
): string {
  const since = t.atStartDay ? `${n2(t.atStart)} on ${shortDay(t.atStartDay)}` : `${n2(t.atStart)} when it was added${t.addedDay ? ` on ${shortDay(t.addedDay)}` : ""}`;
  const added = n2(t.now - t.atStart);
  return named
    ? `${t.title}: ${added} added since ${shortDay(startDay)} (${n2(t.now)} now, ${since})`
    : `What was added since ${shortDay(startDay)}: ${added} (${n2(t.now)} now, ${since})`;
}

/**
 * M4 (step 3 review), final review L18: what happens to a hand target's
 * number when there is no choice to offer, said before saving. From the
 * period running now: "October starts at 0. The 6 checked in so far stay
 * in Activity and won't count." From a later Starts, the number so far is
 * this period's: "November starts at 0. October's 6 so far stay in
 * Activity and won't count toward November."
 */
export function restartingLine(periodName: string, targets: ReadonlyArray<{ title: string; now: number; startValue: number }>, currentName: string | null = null): string | null {
  if (targets.length === 0) return null;
  const later = currentName && currentName !== periodName ? currentName : null;
  if (targets.length === 1) {
    const t = targets[0];
    return later
      ? `${periodName} starts at ${n2(t.startValue)}. ${later}'s ${n2(t.now)} so far stay in Activity and won't count toward ${periodName}.`
      : `${periodName} starts at ${n2(t.startValue)}. The ${n2(t.now)} checked in so far stay in Activity and won't count.`;
  }
  return later
    ? `${periodName} starts each target at its start value. ${later}'s numbers so far stay in Activity and won't count toward ${periodName}.`
    : `${periodName} starts each target at its start value. What was checked in so far stays in Activity and won't count.`;
}

/** M8: under Starts when a one-time goal becomes repeating, "The due date 31 Oct is removed." */
export function dueDateRemovedLine(endDate: string | null | undefined): string | null {
  return endDate ? `The due date ${shortDay(endDate.slice(0, 10))} is removed.` : null;
}

/**
 * Repeating back to One time while no period has closed (step 2 review M5,
 * step 3 review M2): the dates the goal had before, as the date fields hold
 * them, so the save puts them back instead of losing them.
 */
export function undoneDates(previous: { startDate: string | null; endDate: string | null } | null | undefined): { startDate: string | null; endDate: string | null } | null {
  if (!previous) return null;
  return { startDate: previous.startDate ? previous.startDate.slice(0, 10) : null, endDate: previous.endDate ? previous.endDate.slice(0, 10) : null };
}

/** A goal whose periods have closed cannot become one time again (A3); said up front. */
export const REPEAT_HAS_HISTORY_WORDS = "This goal has history. Stop it repeating and create a one-time goal instead.";

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
 * reminder rhythm is Monthly and whose due date is the last day of a month,
 * with its start date empty or that month's 1st (final review M3: a goal
 * made with no start date is the commonest monthly goal), and only while
 * `today` (the workspace's day, yyyy-mm-dd) falls inside that month: a goal
 * for a month long past would start repeating from today and leave its own
 * result behind (final review L2). Never on a completed goal.
 */
export function offersMonthlyConversion(
  g: { repeat?: string | null; checkInCadence?: string | null; startDate?: string | null; endDate?: string | null; completedAt?: string | null },
  today: string,
): boolean {
  if (g.repeat || g.completedAt || g.checkInCadence !== "MONTHLY" || !g.endDate) return false;
  const e = g.endDate.slice(0, 10);
  const first = `${e.slice(0, 7)}-01`;
  if (e !== lastOfMonth(first)) return false;
  if (g.startDate && g.startDate.slice(0, 10) !== first) return false;
  return today >= first && today <= e;
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
 * The repeating goal's slot in the row menu (A4, final review M6): Stop
 * repeating on a running goal; Keep repeating on one set to end with the
 * period running now (it undoes Stop repeating: Ends goes back to Never);
 * Repeat again on an ended goal (it restarts from the period running now),
 * only while the switch is on, as the server allows it. Null otherwise.
 */
export function repeatMenuAction(g: RepeatingRowFacts, recurringOn: boolean): "stop" | "keep" | "again" | null {
  if (!isGoalCadence(g.repeat)) return null;
  if (g.completedAt) return recurringOn ? "again" : null;
  if (!g.period) return null;
  return stopRepeatingOffered(g) ? "stop" : "keep";
}

/**
 * The Delete goal confirm (A4): a goal with closed periods names what goes
 * ("12 months of results") and points at Stop repeating while it still runs.
 */
export function deleteGoalWords(title: string, history: { repeat: string | null | undefined; closed: number; ended: boolean } | null): string {
  const kids = "any goals that support it move up to the top level";
  if (history && isGoalCadence(history.repeat) && history.closed > 0) {
    const keep = history.ended ? "" : " To keep its history, choose Stop repeating instead.";
    return `Delete "${title}"? Its targets, check-ins and ${periodCount(history.repeat, history.closed)} of results go with it, and ${kids}.${keep} This can't be undone.`;
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

/**
 * The Details strip's Repeats row: "Every month, since October 2026" or
 * "Every month, October 2026 to March 2027", and for a goal that has ended
 * "Every week, ended after the week of 19 Oct" (final review L10).
 */
export function repeatsRowText(repeat: GoalCadence, startLabel: string | null, untilLabel: string | null, started: boolean, endedAfter: string | null = null): string {
  const every = UNIT[repeat].every;
  // "Every week, since the week of 7 Sep", not "since Week of 7 Sep".
  const inLine = (l: string) => l.replace(/^Week of /, "the week of ");
  if (endedAfter) return `${every}, ended after ${inLine(endedAfter)}`;
  if (!startLabel) return every;
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

/**
 * The percent a closed period's result shows beside it (B6, final review
 * M7): the unclamped attainment only when the result is Hit ("Hit, 112%"),
 * else the clamped progress the result was decided on. The attainment is
 * the mean of unclamped targets, so one target at 300% and two at 0% would
 * read "Missed, 100%"; the clamped mean reads "Missed, 33%". Null for Not
 * measured.
 */
export function shownPercent(p: { result: string | null; progress: number | null; attainment: number | null }): number | null {
  if (p.result === "NOT_MEASURED") return null;
  if (p.result === "HIT") return p.attainment ?? p.progress;
  return p.progress;
}

/** "Hit, 112%", "Missed, 33%" (B6: the result is decided on the clamped progress; the percent is shownPercent's). */
export function resultWords(resultLabel: string, p: { result: string | null; progress: number | null; attainment: number | null }): string {
  const pct = shownPercent(p);
  return pct == null ? resultLabel : `${resultLabel}, ${pct}%`;
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
 * numbers until 5 Nov", "Open for KPI numbers until 30 Nov", "Closing. Its
 * final numbers are being saved." (final review L6) and, once closed, the
 * last day it took numbers, the same day a late check-in's 409 names (final
 * review M4): "Took numbers until 5 Oct. Its numbers are final." Null for
 * the period running now.
 */
export function periodTargetsLine(p: PeriodLineFacts, fmtDay: (key: string) => string = (k) => shortDay(k)): string | null {
  if (p.state === "open") return null;
  if (p.state === "closed") {
    const day = p.kpiHeld && p.kpiLastDay ? p.kpiLastDay : p.graceLastDay;
    return `Took numbers until ${fmtDay(day)}. Its numbers are final.`;
  }
  if (p.state === "closing") return CLOSING_WORDS;
  if (p.takesLateNumbers) {
    const kpi = p.kpiHeld && p.kpiLastDay ? ` KPI numbers until ${fmtDay(p.kpiLastDay)}.` : "";
    return `Open for late numbers until ${fmtDay(p.graceLastDay)}.${kpi}`;
  }
  return p.kpiHeld && p.kpiLastDay ? `Open for KPI numbers until ${fmtDay(p.kpiLastDay)}.` : CLOSING_WORDS;
}

/** A period past its close that the cron has not frozen yet (B3, final review L6). */
export const CLOSING_WORDS = "Closing. Its final numbers are being saved.";

/** A period's name inside a sentence: "October" for a month, "the week of 19 Oct", "Q3 FY27", "FY27". */
export function periodNameInSentence(label: string, cadence: GoalCadence): string {
  if (cadence === "MONTHLY") return label.replace(/ \d{4}$/, "");
  return label.replace(/^Week of /, "the week of ");
}

/** The same at the start of a sentence: "October", "The week of 19 Oct". */
function periodNameAtStart(label: string, cadence: GoalCadence): string {
  const n = periodNameInSentence(label, cadence);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * H1 (final review): while the period before the one running now still
 * takes numbers, the Targets card of the period running now says so, and
 * links to it: "October still takes late numbers until 5 Nov." with "Check
 * in for October" (for someone who may check in), or, past its grace and
 * held for its KPI month, "October still takes KPI numbers until 30 Nov."
 * with "Open October". Null when it takes nothing more.
 */
export function lateNumbersNote(
  prev: { label: string; cadence: GoalCadence; takesLateNumbers: boolean; kpiHeld: boolean; graceLastDay: string; kpiLastDay: string | null } | null,
  canCheckIn: boolean,
  fmtDay: (key: string) => string = (k) => shortDay(k),
): { line: string; linkLabel: string } | null {
  if (!prev) return null;
  const start = periodNameAtStart(prev.label, prev.cadence);
  const inLine = periodNameInSentence(prev.label, prev.cadence);
  if (prev.takesLateNumbers) {
    return { line: `${start} still takes late numbers until ${fmtDay(prev.graceLastDay)}.`, linkLabel: canCheckIn ? `Check in for ${inLine}` : `Open ${inLine}` };
  }
  if (prev.kpiHeld && prev.kpiLastDay) return { line: `${start} still takes KPI numbers until ${fmtDay(prev.kpiLastDay)}.`, linkLabel: `Open ${inLine}` };
  return null;
}

/**
 * M1 (final review): the Summary of a period that has ended but still takes
 * numbers shows its result so far, not a pace over a window that is over,
 * and no next step: "Week of 19 Oct ended: Partly hit so far, 84%. Late
 * numbers until 27 Oct." The percent is shownPercent's (the attainment only
 * beside Hit).
 */
export function endedSoFar(p: {
  label: string;
  state: "open" | "grace" | "closing" | "closed";
  progress: number | null;
  attainment: number | null;
  takesLateNumbers: boolean;
  kpiHeld: boolean;
  graceLastDay: string;
  kpiLastDay: string | null;
}, fmtDay: (key: string) => string = (k) => shortDay(k)): { head: string; result: GoalResult; chip: string; percent: number | null; tail: string; text: string } | null {
  if (p.state !== "grace" && p.state !== "closing") return null;
  const result = resultFor(p.progress);
  const percent = shownPercent({ result, progress: p.progress, attainment: p.attainment });
  const chip = result === "NOT_MEASURED" ? "Not measured yet" : `${RESULT_LABEL[result]} so far`;
  const tail = p.state === "closing"
    ? "Its final numbers are being saved."
    : p.takesLateNumbers
      ? `Late numbers until ${fmtDay(p.graceLastDay)}.${p.kpiHeld && p.kpiLastDay ? ` KPI numbers until ${fmtDay(p.kpiLastDay)}.` : ""}`
      : p.kpiHeld && p.kpiLastDay ? `KPI numbers until ${fmtDay(p.kpiLastDay)}.` : "Its final numbers are being saved.";
  const head = `${p.label} ended:`;
  return { head, result, chip, percent, tail, text: `${head} ${chip}${percent != null ? `, ${percent}%` : ""}. ${tail}` };
}

/**
 * The Summary card's top line beside the period control (E2): what is left
 * of the period running now ("9 days left"), with its dates for a quarter or
 * a year, whose name alone says no dates (final review L14: "1 Oct 2026 to
 * 31 Dec 2026, 9 days left"); a period that has ended shows its dates.
 */
export function periodTopLine(p: { cadence: GoalCadence; current: boolean; state: string; daysLeft: number; datesLabel: string }): string {
  if (!(p.current && p.state === "open")) return p.datesLabel;
  const left = leftWords(p.daysLeft);
  return p.cadence === "QUARTERLY" || p.cadence === "YEARLY" ? `${p.datesLabel}, ${left}` : left;
}

/** H2 (final review): the top line of a repeating goal whose first period has not started. "Starts 1 Nov. Check-ins open then." */
export function notStartedLine(startsOn: string | null, fmtDay: (key: string) => string = (k) => shortDay(k)): string {
  return startsOn ? `Starts ${fmtDay(startsOn)}. Check-ins open then.` : "Not started yet. Check-ins open when it starts.";
}

/* ───────────────────────── The goal page's doors (2.0, A5, E2, E3) ───────────────────────── */

const CHECKIN_WORD: Record<string, string> = { WEEKLY: "Weekly", BIWEEKLY: "Every two weeks", MONTHLY: "Monthly", NONE: "No reminders" };

/** The save is blocked by a rule the form already shows: the words the footer says when Save is pressed (final review L19). */
export function blockedSaveWords(b: { companyBlocked: boolean; kpiBlocksWeekly: boolean; historyBlocksOneTime: boolean }): string | null {
  if (b.historyBlocksOneTime) return REPEAT_HAS_HISTORY_WORDS;
  if (b.kpiBlocksWeekly) return "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.";
  if (b.companyBlocked) return "Only an Admin, the People team or the goal's owner can make a Company goal. Make yourself the owner, or ask an Admin.";
  return null;
}

/**
 * What the goal page offers on a goal, decided in one place so the switch
 * provably closes every door (2.0): the "Make this a monthly goal" link
 * (A5) and the target editor (E3) only while RECURRING_GOALS is on and the
 * viewer can edit; the reminder row reads "Check-ins" exactly as before
 * unless the switch is on or the goal already repeats, and hides only then,
 * when every target is measured automatically. Then it reads "Reminders" with
 * "Weekly, to the owner" (final review L11: the longer label wrapped in the
 * Details column).
 */
export function goalPageDoors(g: {
  recurringOn: boolean;
  canEdit: boolean;
  repeat: string | null;
  checkInCadence: string;
  allAutomatic: boolean;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  /** The workspace's day, yyyy-mm-dd (A5 is offered only inside the goal's month). */
  today: string;
}): { migrationOffer: boolean; targetEditor: boolean; remindLabel: string; remindWord: string; remindHidden: boolean } {
  const newWords = g.recurringOn || Boolean(g.repeat);
  return {
    migrationOffer: g.recurringOn && g.canEdit && offersMonthlyConversion(g, g.today),
    targetEditor: g.recurringOn && g.canEdit,
    remindLabel: newWords ? "Reminders" : "Check-ins",
    remindWord: !newWords ? CHECKIN_WORD[g.checkInCadence] ?? g.checkInCadence
      : g.checkInCadence === "NONE" ? "Off" : `${CHECKIN_WORD[g.checkInCadence] ?? g.checkInCadence}, to the owner`,
    remindHidden: newWords && g.allAutomatic,
  };
}
