// Scoring & reviews' words for a cadence (settings-cleanup Phase 6), kept out
// of the page so they are tested on their own: the day or month a cadence
// lands on, and the line a read-only viewer reads under a cadence that is on.

import type { CadenceKey, CadenceSetting } from "@/lib/review-cadence";
import { MONTH_NAMES } from "@/lib/settings/org-policy";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The visible words before a cadence's day or month control (they also start its accessible name). */
export const ANCHOR_WORDS: Record<CadenceKey, string> = {
  weekly: "Due on",
  monthly: "Opens on day",
  quarterly: "Opens on day",
  annual: "Opens in",
};

export function anchorWord(cadence: CadenceKey, anchor: number): string {
  if (cadence === "weekly") return WEEKDAYS[(anchor - 1 + 7) % 7] ?? `day ${anchor}`;
  if (cadence === "annual") return MONTH_NAMES[(anchor - 1 + 12) % 12] ?? `month ${anchor}`;
  if (cadence === "monthly") return `day ${anchor} of the month`;
  return `day ${anchor} of the quarter`;
}

/**
 * What a cadence that is on does, in one line: "Friday · remind 1 day before
 * · opens itself". The line starts with a capital, as a line of its own does
 * ("Day 1 of the month", Phase 6 review, L3).
 */
export function cadenceSummary(cadence: CadenceKey, c: Pick<CadenceSetting, "anchor" | "reminderLeadDays" | "autoOpen">): string {
  const n = c.reminderLeadDays;
  const at = anchorWord(cadence, c.anchor);
  return `${at.charAt(0).toUpperCase()}${at.slice(1)} · remind ${n} ${n === 1 ? "day" : "days"} before${c.autoOpen ? " · opens itself" : ""}`;
}
