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

export interface RecurrenceRule {
  freq: RecurFreq;
  /** Repeat every N units (>= 1). */
  interval: number;
}

const FREQS: readonly RecurFreq[] = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"];
const UNIT_LABEL: Record<RecurFreq, string> = { DAY: "day", WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" };

/** Validate an arbitrary blob (Item.recurRule column or legacy
 *  metadata.recurrence) into a rule. Returns null when absent/malformed so
 *  callers can treat "no recurrence" uniformly. */
export function parseRecurrence(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== "object") return null;
  // Tolerate a legacy metadata wrapper ({ recurrence: {...} }).
  const obj = "recurrence" in (raw as Record<string, unknown>)
    ? (raw as Record<string, unknown>).recurrence
    : raw;
  if (!obj || typeof obj !== "object") return null;
  const freq = (obj as Record<string, unknown>).freq;
  if (typeof freq !== "string" || !FREQS.includes(freq as RecurFreq)) return null;
  const rawInterval = (obj as Record<string, unknown>).interval;
  const interval = typeof rawInterval === "number" && rawInterval >= 1 ? Math.floor(rawInterval) : 1;
  return { freq: freq as RecurFreq, interval };
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
