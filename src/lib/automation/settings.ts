// The workspace's automation settings, read tolerantly from
// Organization.settings. Settings > Apps and modules > Automations (Phase 8)
// writes them; until it does, every key is absent and the defaults hold.
//
//   settings.work.automationsPaused  true pauses every automation in the
//                                    workspace (nothing runs, nothing is
//                                    charged). Absent or anything else: on.
//   settings.work.automationQuota    the monthly action allowance. The older
//                                    top-level settings.automationLimit is
//                                    still read, so a workspace that already
//                                    set it keeps its number.
//
// Pure, so the engine, the API routes and the tests agree.

export const DEFAULT_MONTHLY_LIMIT = 1000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

export interface AutomationSettings {
  paused: boolean;
  limit: number;
}

export function readAutomationSettings(settings: unknown): AutomationSettings {
  const s = asRecord(settings);
  const work = asRecord(s.work);
  return {
    paused: work.automationsPaused === true,
    limit: positiveInt(work.automationQuota) ?? positiveInt(s.automationLimit) ?? DEFAULT_MONTHLY_LIMIT,
  };
}

/** "2026-09" for a date, in the server's calendar (the meter's own months). */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The [start, end) of a YYYY-MM month, or null when the key is malformed.
 * Months far outside a sane range are refused rather than scanned.
 */
export function monthRange(key: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

/** The month before or after a YYYY-MM key. */
export function shiftMonth(key: string, delta: number): string {
  const r = monthRange(key);
  const base = r ? r.start : new Date();
  return monthKey(new Date(base.getFullYear(), base.getMonth() + delta, 1));
}
