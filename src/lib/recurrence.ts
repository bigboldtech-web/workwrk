// Task recurrence ("Repeat") — a small, pure module shared by the client
// DatePlanner (to edit + describe a rule) and the server (PATCH route + the
// recurring-tasks cron). No server deps so it's safe to import from a
// "use client" component.
//
// Spawn model: the rule lives on the SERIES ANCHOR task as columns
//   recurRule   = { freq: "DAY"|"WEEK"|"MONTH"|"QUARTER"|"YEAR", interval }
//   recurNextAt = when the cron spawns the next fresh copy.
// The cron clones the anchor (+ its subtree) as a fresh open task each cycle and
// advances recurNextAt. Copies carry no rule, so only the anchor recurs.

export type RecurFreq = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

/** When the next cycle fires:
 *  - SCHEDULE    — date/cron driven (Item.recurNextAt). Default.
 *  - ON_COMPLETE — fires the moment the task is marked done (ClickUp's
 *                  "On status change: Complete"); recurNextAt stays null. */
export type RecurTrigger = "SCHEDULE" | "ON_COMPLETE";

export interface RecurrenceRule {
  freq: RecurFreq;
  /** Repeat every N units (>= 1). */
  interval: number;
  /** What advances the series. Default SCHEDULE. */
  trigger?: RecurTrigger;
  /** true  = spawn a fresh copy each cycle (each period gets its own record);
   *  false = roll THIS same task forward. Default true (back-compat). */
  createNew?: boolean;
  /** false = the series ends after `count` occurrences or once a cycle passes
   *  `until`. Default true (never ends until Repeat is turned off). */
  forever?: boolean;
  /** Remaining occurrences when !forever (decremented as each cycle runs). */
  count?: number | null;
  /** ISO end date when !forever. Once a cycle would land after this, stop. */
  until?: string | null;
  /** Status value to set when the task recurs (the new copy, or the rolled-
   *  forward task). null/absent = the board's first open status. */
  resetStatus?: string | null;
  /** Keep the due date in step with the recurrence each cycle. Default true. */
  syncDue?: boolean;
}

const FREQS: readonly RecurFreq[] = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"];
const UNIT_LABEL: Record<RecurFreq, string> = { DAY: "day", WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" };

/** Validate an arbitrary blob (Item.recurRule column or legacy
 *  metadata.recurrence) into a rule. Returns null when absent/malformed so
 *  callers can treat "no recurrence" uniformly. Extra ClickUp-parity options
 *  (trigger / createNew / forever / count / until / resetStatus / syncDue) are
 *  read when present and defaulted otherwise, so old {freq,interval} rules keep
 *  their original spawn-a-copy-on-schedule behavior. */
export function parseRecurrence(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== "object") return null;
  // Tolerate a legacy metadata wrapper ({ recurrence: {...} }).
  const obj = "recurrence" in (raw as Record<string, unknown>)
    ? (raw as Record<string, unknown>).recurrence
    : raw;
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const freq = o.freq;
  if (typeof freq !== "string" || !FREQS.includes(freq as RecurFreq)) return null;
  const rawInterval = o.interval;
  const interval = typeof rawInterval === "number" && rawInterval >= 1 ? Math.floor(rawInterval) : 1;

  const trigger: RecurTrigger = o.trigger === "ON_COMPLETE" ? "ON_COMPLETE" : "SCHEDULE";
  const createNew = typeof o.createNew === "boolean" ? o.createNew : true;
  const forever = typeof o.forever === "boolean" ? o.forever : true;
  const count = typeof o.count === "number" && o.count >= 0 ? Math.floor(o.count) : null;
  const until = typeof o.until === "string" && o.until ? o.until : null;
  const resetStatus = typeof o.resetStatus === "string" && o.resetStatus ? o.resetStatus : null;
  const syncDue = typeof o.syncDue === "boolean" ? o.syncDue : true;

  return { freq: freq as RecurFreq, interval, trigger, createNew, forever, count, until, resetStatus, syncDue };
}

/** True once the series has run its course under a non-forever rule: the
 *  occurrence count is exhausted, or `nextCycle` would fall past `until`. */
export function seriesEnded(rule: RecurrenceRule, nextCycle: Date): boolean {
  if (rule.forever !== false) return false;
  if (typeof rule.count === "number" && rule.count <= 0) return true;
  if (rule.until) {
    const end = new Date(rule.until);
    if (!Number.isNaN(end.getTime()) && nextCycle.getTime() > end.getTime()) return true;
  }
  return false;
}

/** Advance a date by one cycle of the rule. Calendar-aware (setMonth /
 *  setFullYear handle month-length + leap years). QUARTER = 3 months. */
export function advanceDate(from: Date | string, rule: RecurrenceRule): Date {
  const d = new Date(from);
  const n = Math.max(1, rule.interval);
  switch (rule.freq) {
    case "DAY": d.setDate(d.getDate() + n); break;
    case "WEEK": d.setDate(d.getDate() + 7 * n); break;
    case "MONTH": d.setMonth(d.getMonth() + n); break;
    case "QUARTER": d.setMonth(d.getMonth() + 3 * n); break;
    case "YEAR": d.setFullYear(d.getFullYear() + n); break;
  }
  return d;
}

/** The next occurrence strictly after `now`, starting from `from` and stepping
 *  by the rule. Used to (a) seed recurNextAt when repeat is turned on and
 *  (b) fast-forward past missed cycles if the cron was down, so at most one
 *  copy spawns per anchor per tick. */
export function nextOccurrence(from: Date | string, rule: RecurrenceRule, now: Date = new Date()): Date {
  let d = new Date(from);
  // Guard against a pathological rule causing an infinite loop.
  for (let i = 0; i < 10000 && d.getTime() <= now.getTime(); i++) {
    d = advanceDate(d, rule);
  }
  return d;
}

/** Human summary, e.g. "Every day", "Every 2 weeks", "Every quarter". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const unit = UNIT_LABEL[rule.freq];
  return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
}
