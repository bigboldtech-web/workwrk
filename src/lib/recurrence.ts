// Task recurrence ("Repeat") — a small, pure module shared by the client
// DatePlanner (to edit + describe a rule) and the server PATCH route (to roll a
// completed recurring task forward). No server deps so it's safe to import from
// a "use client" component.
//
// The rule lives in Item.metadata.recurrence (no dedicated column) as
//   { freq: "DAY"|"WEEK"|"MONTH"|"YEAR", interval: number }
// Recurrence is completion-based: when the task is moved to a done status the
// server advances its dates by the rule and resets it to the first open status
// (ClickUp's default recurring behaviour). This needs no external scheduler.

export type RecurFreq = "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface RecurrenceRule {
  freq: RecurFreq;
  /** Repeat every N units (>= 1). */
  interval: number;
}

const FREQS: readonly RecurFreq[] = ["DAY", "WEEK", "MONTH", "YEAR"];
const UNIT_LABEL: Record<RecurFreq, string> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

/** Read + validate a rule out of an Item.metadata blob. Returns null when
 *  absent or malformed so callers can treat "no recurrence" uniformly. */
export function parseRecurrence(metadata: unknown): RecurrenceRule | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).recurrence;
  if (!raw || typeof raw !== "object") return null;
  const freq = (raw as Record<string, unknown>).freq;
  if (typeof freq !== "string" || !FREQS.includes(freq as RecurFreq)) return null;
  const rawInterval = (raw as Record<string, unknown>).interval;
  const interval = typeof rawInterval === "number" && rawInterval >= 1 ? Math.floor(rawInterval) : 1;
  return { freq: freq as RecurFreq, interval };
}

/** Advance a date by one cycle of the rule. Calendar-aware (setMonth /
 *  setFullYear handle month-length + leap years). */
export function advanceDate(from: Date | string, rule: RecurrenceRule): Date {
  const d = new Date(from);
  const n = Math.max(1, rule.interval);
  switch (rule.freq) {
    case "DAY": d.setDate(d.getDate() + n); break;
    case "WEEK": d.setDate(d.getDate() + 7 * n); break;
    case "MONTH": d.setMonth(d.getMonth() + n); break;
    case "YEAR": d.setFullYear(d.getFullYear() + n); break;
  }
  return d;
}

/** Human summary, e.g. "Every day", "Every 2 weeks". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const unit = UNIT_LABEL[rule.freq];
  return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
}
