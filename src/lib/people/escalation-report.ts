// The counting rules behind the escalation thresholds REPORT
// (scripts/report-escalation-thresholds.ts, spec-teams-people T9, PO-11).
//
// A threshold sits on a job title (Threshold.roleId). The report joins it to
// the people who hold that title (User.roleId) and then to their work on the
// Items model (owner OR any assignee: the legacy Task table is dead since
// Phase 2). Nothing here writes, notifies or escalates; the job that would act
// on a threshold waits for the founder's approval, and until then the
// Thresholds card stays behind "Show upcoming features" with "Not enforced
// yet". Pure, so every rule is pinned by escalation-report.test.ts.

import { isDoneStatusName } from "../board-items-shared";

/** A threshold's value as milliseconds, when its unit is a duration; else null. */
export function thresholdDurationMs(value: number, unit: string | null | undefined): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return null;
  if (u === "m" || u.startsWith("min")) return value * 60_000;
  if (u === "h" || u.startsWith("hour") || u === "hr" || u === "hrs") return value * 3_600_000;
  if (u === "d" || u.startsWith("day")) return value * 86_400_000;
  if (u === "w" || u.startsWith("week")) return value * 7 * 86_400_000;
  return null;
}

/**
 * Whether the trigger is one the Items model can measure today: "overdue by
 * N". Other triggers (unclaimed, no reply, SLA breach on a ticket) have no
 * field to read on an Item yet, so the report says so instead of guessing.
 */
export function isOverdueTrigger(trigger: string | null | undefined): boolean {
  return /\b(overdue|past due|late|due)\b/i.test(trigger ?? "");
}

export interface ReportItem {
  ownerId: string | null;
  assigneeIds: string[];
  status: string | null;
  dueAt: Date | null;
}

/** The people on an item, owner first, each once. */
export function itemPeople(item: Pick<ReportItem, "ownerId" | "assigneeIds">): string[] {
  const out: string[] = [];
  if (item.ownerId) out.push(item.ownerId);
  for (const id of item.assigneeIds ?? []) if (id && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Would this item have crossed an overdue threshold inside the window?
 * It must belong to a holder (owner or assignee), be open (a done status
 * never escalates), and its due moment plus the threshold must fall inside
 * [since, now]. An item due 20 days ago with a 1-day threshold crossed 19
 * days ago: counted. One due 40 days ago crossed before the window opened:
 * not counted (it would have escalated in an earlier window).
 */
export function wouldHaveEscalated(
  item: ReportItem,
  holderIds: ReadonlySet<string>,
  thresholdMs: number,
  since: Date,
  now: Date,
): boolean {
  if (!item.dueAt) return false;
  if (isDoneStatusName(item.status)) return false;
  if (!itemPeople(item).some((id) => holderIds.has(id))) return false;
  const crossedAt = item.dueAt.getTime() + thresholdMs;
  return crossedAt >= since.getTime() && crossedAt <= now.getTime();
}

export interface ThresholdSummary {
  holders: number;
  /** Holders an escalation could not reach: no named target and no manager. */
  unreachable: number;
  /** Items that would have escalated in the window, or null when the trigger is not measurable. */
  wouldEscalate: number | null;
}

/**
 * Who a threshold's escalation reaches. A named escalatedToId wins; without
 * one, each holder's manager. A holder with neither is unreachable, which is
 * the number the founder needs before approving a job that would otherwise
 * escalate into nobody.
 */
export function unreachableHolders(escalatedToId: string | null | undefined, holders: { managerId: string | null }[]): number {
  if (escalatedToId) return 0;
  return holders.filter((h) => !h.managerId).length;
}
