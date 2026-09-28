// Weekly review, the heartbeat cadence. Helpers for:
//   - Computing the current week's ISO start (Monday 00:00 UTC).
//   - Get-or-create the user's DRAFT review for the current week.
//   - Submit a review (DRAFT → SUBMITTED with timestamp).
//
// We rely on Prisma's @@unique([userId, periodStart]) so upserts are
// race-free even if two tabs try to create simultaneously.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getEffectiveReportTree } from "@/lib/reporting-line";

export interface KpiSnapshot {
  kpiId: string;
  value: number | null;
  note?: string;
}

export interface KraProgressEntry {
  kraId: string;
  progressPct: number; // 0..100
  note?: string;
}

export interface WeeklyReviewDoc {
  id: string;
  organizationId: string;
  userId: string;
  periodStart: Date;
  kpiSnapshots: KpiSnapshot[];
  kraProgress: KraProgressEntry[];
  highlights: string | null;
  blockers: string | null;
  plan: string | null;
  status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED";
  submittedAt: Date | null;
  managerId: string | null;
  managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
  managerNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Return the Monday 00:00 UTC of the ISO week the given date falls in.
 * Sunday is treated as the LAST day of the previous week (ISO convention).
 */
export function weekStartFor(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/**
 * The Sunday 23:59:59 UTC that closes the same ISO week.
 */
export function weekEndFor(date: Date = new Date()): Date {
  const start = weekStartFor(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function shapeFromRow(row: {
  id: string;
  organizationId: string;
  userId: string;
  periodStart: Date;
  kpiSnapshots: unknown;
  kraProgress: unknown;
  highlights: string | null;
  blockers: string | null;
  plan: string | null;
  status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED";
  submittedAt: Date | null;
  managerId: string | null;
  managerStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
  managerNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WeeklyReviewDoc {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    periodStart: row.periodStart,
    kpiSnapshots: Array.isArray(row.kpiSnapshots) ? (row.kpiSnapshots as KpiSnapshot[]) : [],
    kraProgress: Array.isArray(row.kraProgress) ? (row.kraProgress as KraProgressEntry[]) : [],
    highlights: row.highlights,
    blockers: row.blockers,
    plan: row.plan,
    status: row.status,
    submittedAt: row.submittedAt,
    managerId: row.managerId,
    managerStatus: row.managerStatus,
    managerNotes: row.managerNotes,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Read the user's review for the given week, or null. Never writes: every
 * GET and page render uses this, and the row is created by the first save
 * (POST /api/me/weekly-review), so opening the page leaves no empty DRAFT.
 */
export async function findWeeklyReview(args: {
  userId: string;
  periodStart?: Date;
}): Promise<WeeklyReviewDoc | null> {
  const periodStart = args.periodStart ?? weekStartFor();
  const row = await prisma.weeklyReview.findUnique({
    where: { userId_periodStart: { userId: args.userId, periodStart } },
  });
  return row ? shapeFromRow(row) : null;
}

/**
 * Get the user's review for the given week, creating a DRAFT if none
 * exists yet. Only a write path calls this (the POST behind the first save). The manager fk is inferred from the user's solid manager
 * at create time so the manager surface can scope on it.
 */
export async function getOrCreateWeeklyReview(args: {
  userId: string;
  organizationId: string;
  periodStart?: Date;
}): Promise<WeeklyReviewDoc> {
  const periodStart = args.periodStart ?? weekStartFor();

  const existing = await prisma.weeklyReview.findUnique({
    where: { userId_periodStart: { userId: args.userId, periodStart } },
  });
  if (existing) return shapeFromRow(existing);

  // Inherit manager from User.managerId at create time. If the user's
  // manager changes mid-week, that's fine, the review keeps the
  // historical manager who is on the hook for this week's submission.
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { managerId: true },
  });

  try {
    const created = await prisma.weeklyReview.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        periodStart,
        managerId: user?.managerId ?? null,
      },
    });
    return shapeFromRow(created);
  } catch (err) {
    // Two first saves raced (two tabs): the other one created the row, so
    // answer with it instead of a 500.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const row = await prisma.weeklyReview.findUnique({
      where: { userId_periodStart: { userId: args.userId, periodStart } },
    });
    if (!row) throw err;
    return shapeFromRow(row);
  }
}

export interface UpdateWeeklyReviewInput {
  kpiSnapshots?: KpiSnapshot[];
  kraProgress?: KraProgressEntry[];
  highlights?: string | null;
  blockers?: string | null;
  plan?: string | null;
}

/**
 * Save a draft. Doesn't move status. The author must own the review
 * (gated at the API layer).
 */
export async function saveWeeklyReviewDraft(
  reviewId: string,
  patch: UpdateWeeklyReviewInput,
): Promise<WeeklyReviewDoc> {
  const data: Record<string, unknown> = {};
  if (patch.kpiSnapshots !== undefined) data.kpiSnapshots = patch.kpiSnapshots as object;
  if (patch.kraProgress !== undefined) data.kraProgress = patch.kraProgress as object;
  if (patch.highlights !== undefined) data.highlights = patch.highlights;
  if (patch.blockers !== undefined) data.blockers = patch.blockers;
  if (patch.plan !== undefined) data.plan = patch.plan;
  const updated = await prisma.weeklyReview.update({ where: { id: reviewId }, data });
  return shapeFromRow(updated);
}

/** Someone else decided (or reopened) this review first. */
export class WeeklyDecisionConflict extends Error {
  constructor() {
    super("Someone else decided this review a moment ago");
    this.name = "WeeklyDecisionConflict";
  }
}

/**
 * Submit a review for manager review. Idempotent, re-submitting a
 * SUBMITTED row just refreshes submittedAt. Sets managerStatus=PENDING
 * so the manager's queue shows it.
 */
export async function submitWeeklyReview(reviewId: string): Promise<WeeklyReviewDoc> {
  // The recorded manager is re-stamped from the person's CURRENT manager at
  // submit (Phase 6 worst case: someone who changed manager, or who had none
  // when the draft was created, submitted into a queue nobody reads). A
  // person with no manager keeps whatever was recorded.
  const row = await prisma.weeklyReview.findUnique({ where: { id: reviewId }, select: { userId: true } });
  const person = row
    ? await prisma.user.findUnique({ where: { id: row.userId }, select: { managerId: true } })
    : null;
  const updated = await prisma.weeklyReview.update({
    where: { id: reviewId },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      managerStatus: "PENDING",
      ...(person?.managerId ? { managerId: person.managerId } : {}),
    },
  });
  return shapeFromRow(updated);
}

/**
 * Why an employee's write to their own weekly review is refused, or null
 * when it may go ahead. Worst cases closed: an approved week reopened (and
 * the manager's approval erased) through the API, and a past week rewritten
 * after the manager read it. Only the current week changes, with a day's
 * slack either side of the Monday boundary for time zones; an approved week
 * never changes; a reviewed week with changes requested only reopens (the
 * edit then goes through the draft).
 */
export function weeklyEditRefusal(
  row: { status: string; managerStatus: string | null; periodStart: Date },
  action: "save" | "submit" | "reopen",
  now: Date = new Date(),
): string | null {
  const SLACK_MS = 14 * 3600_000;
  const weekMs = 7 * 24 * 3600_000;
  if (now.getTime() - row.periodStart.getTime() > weekMs + SLACK_MS) return "Only this week's review can change. Past weeks are a record.";
  if (row.status === "ACKNOWLEDGED") {
    if (row.managerStatus !== "CHANGES_REQUESTED") return "Your manager already approved this week, so it can no longer change";
    if (action !== "reopen") return "Your manager asked for changes. Reopen the review to edit it.";
  }
  return null;
}

/**
 * Reopen a SUBMITTED review, or a reviewed one whose manager asked for
 * changes, back to DRAFT. Caller side enforces that the IC owns the review
 * (weeklyEditRefusal); the where clause never lets an APPROVED week reopen,
 * even from a caller that skipped the check.
 */
export async function reopenWeeklyReview(reviewId: string): Promise<WeeklyReviewDoc> {
  const updated = await prisma.weeklyReview.update({
    where: { id: reviewId, OR: [{ status: { not: "ACKNOWLEDGED" } }, { managerStatus: "CHANGES_REQUESTED" }] },
    data: { status: "DRAFT", submittedAt: null, managerStatus: null },
  });
  return shapeFromRow(updated);
}

/**
 * List recent reviews for a user (history feed). Newest first.
 */
export async function listMyWeeklyReviews(userId: string, opts: { take?: number } = {}): Promise<WeeklyReviewDoc[]> {
  const rows = await prisma.weeklyReview.findMany({
    where: { userId },
    orderBy: { periodStart: "desc" },
    take: opts.take ?? 24,
  });
  return rows.map(shapeFromRow);
}

// ── Manager surface ───────────────────────────────────────────────

export interface ManagerReviewQueueItem extends WeeklyReviewDoc {
  subject: { id: string; firstName: string; lastName: string; email: string; avatar: string | null } | null;
}

/**
 * Whose weekly reviews a manager's queue holds: the people who report to
 * them NOW (User.managerId), whoever was recorded on the row when it was
 * submitted, plus rows recorded to them whose subject has no manager today.
 * A report who moved takes their pending review to the new manager (the
 * old one no longer sees it or decides it), and nobody's review is left in
 * a queue nobody reads.
 */
export function managerQueueWhere(managerId: string): Prisma.WeeklyReviewWhereInput {
  return {
    OR: [
      { user: { managerId, deletedAt: null } },
      { managerId, user: { managerId: null, deletedAt: null } },
    ],
  };
}

/**
 * How many weekly reviews await `managerId`'s decision: the SAME where clause
 * listReviewsForManager runs for the /team/reviews queue (status SUBMITTED),
 * uncapped, so the sidebar badge and the queue can never disagree.
 */
export async function countReviewsAwaitingManager(managerId: string): Promise<number> {
  return prisma.weeklyReview.count({ where: { AND: [managerQueueWhere(managerId), { status: "SUBMITTED" }] } });
}

/**
 * The CHAIN queue (spec-teams-performance /team/reviews Data, PO-16): every
 * weekly review whose subject is anywhere below `managerId` (solid lines any
 * depth the effective tree walks, plus dotted reports), together with the
 * direct queue above, so the chain count is always a superset of the direct
 * one. The manager's own review never counts. My team's attention row and
 * its sidebar badge read this; the queue's "Direct reports only" switch
 * narrows to managerQueueWhere.
 */
export async function chainQueueWhere(managerId: string): Promise<Prisma.WeeklyReviewWhereInput> {
  const tree = (await getEffectiveReportTree(managerId)).filter((id) => id !== managerId);
  return tree.length
    ? { OR: [managerQueueWhere(managerId), { userId: { in: tree }, user: { deletedAt: null } }] }
    : managerQueueWhere(managerId);
}

/** How many weekly reviews in the viewer's chain await a decision (uncapped). */
export async function countChainReviewsAwaiting(managerId: string): Promise<number> {
  return prisma.weeklyReview.count({ where: { AND: [await chainQueueWhere(managerId), { status: "SUBMITTED" }] } });
}

/**
 * The manager queue (managerQueueWhere), optionally by status. Uncapped
 * unless `take` is passed. `alsoDecidedBy` adds the rows the caller decided
 * themselves (from the activity log), so a skip-level manager or the People
 * team who approved on the Alignment board sees that row under Acted.
 * `since` bounds a history list by time rather than by a row cap.
 * Includes the subject so the queue can render who-and-when at a glance.
 */
/** How many reviews the direct manager queue holds, for a server total. */
export async function countReviewsForManager(
  managerId: string,
  opts: { status?: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" } = {},
): Promise<number> {
  return prisma.weeklyReview.count({
    where: { AND: [managerQueueWhere(managerId), opts.status ? { status: opts.status } : {}] },
  });
}

export async function listReviewsForManager(
  managerId: string,
  opts: { status?: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED"; take?: number; skip?: number; since?: Date; sinceDays?: number; alsoDecidedBy?: boolean } = {},
): Promise<ManagerReviewQueueItem[]> {
  if (opts.sinceDays && !opts.since) opts = { ...opts, since: new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000) };
  let decidedIds: string[] = [];
  if (opts.alsoDecidedBy) {
    const logs = await prisma.activityLog.findMany({
      where: {
        actorId: managerId,
        type: "weekly_review_decided",
        targetType: "weekly_review",
        ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
      },
      select: { targetId: true },
    });
    decidedIds = [...new Set(logs.map((l) => l.targetId).filter((x): x is string => !!x))];
  }
  const population: Prisma.WeeklyReviewWhereInput = decidedIds.length
    ? { OR: [managerQueueWhere(managerId), { id: { in: decidedIds } }] }
    : managerQueueWhere(managerId);
  const rows = await prisma.weeklyReview.findMany({
    where: {
      AND: [
        population,
        opts.status ? { status: opts.status } : {},
        opts.since ? { OR: [{ reviewedAt: { gte: opts.since } }, { reviewedAt: null, updatedAt: { gte: opts.since } }] } : {},
      ],
    },
    orderBy: [{ submittedAt: "desc" }, { periodStart: "desc" }, { id: "desc" }],
    ...(opts.take ? { take: opts.take } : {}),
    ...(opts.skip ? { skip: opts.skip } : {}),
  });

  const subjectIds = Array.from(new Set(rows.map((r) => r.userId)));
  const subjects = subjectIds.length
    ? await prisma.user.findMany({
        where: { id: { in: subjectIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const byId = new Map(subjects.map((s) => [s.id, s] as const));

  return rows.map((r) => ({
    ...shapeFromRow(r),
    subject: byId.get(r.userId) ?? null,
  }));
}

/**
 * Read a single review (manager or subject). Returns null if the
 * caller is neither.
 */
export async function getReviewForViewer(
  reviewId: string,
  viewerId: string,
): Promise<(WeeklyReviewDoc & { subject: { id: string; firstName: string; lastName: string; email: string; avatar: string | null } | null }) | null> {
  const row = await prisma.weeklyReview.findUnique({ where: { id: reviewId } });
  if (!row) return null;
  if (row.userId !== viewerId && row.managerId !== viewerId) return null;
  const subject = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  });
  return { ...shapeFromRow(row), subject };
}

/**
 * A manager's decision on a weekly review (src/lib/people/weekly-decision.ts
 * is the payload and the transition rule; the API layer is the gate).
 *
 *   APPROVED           managerStatus=APPROVED, status=ACKNOWLEDGED
 *   CHANGES_REQUESTED  managerStatus=CHANGES_REQUESTED, status=ACKNOWLEDGED
 *   REOPEN             managerStatus=PENDING, status=SUBMITTED (the Undo)
 *
 * `managerId` is NOT overwritten with the actor any more. It is the recorded
 * manager the queue and the badge are keyed on, so a skip-level decision
 * used to move the row out of the direct manager's history and badge. The
 * actor is recorded in the activity log by the route instead.
 *
 * The retired `{ action }` argument is still accepted for one release.
 */
export async function actOnReview(
  reviewId: string,
  args:
    | { decision: "APPROVED" | "CHANGES_REQUESTED" | "REOPEN"; notes?: string | null; actorId: string }
    | { action: "approve" | "request_changes"; notes?: string; actorId: string },
): Promise<WeeklyReviewDoc> {
  const decision =
    "decision" in args ? args.decision : args.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
  const data =
    decision === "REOPEN"
      ? { managerStatus: "PENDING" as const, managerNotes: null, reviewedAt: null, status: "SUBMITTED" as const }
      : {
          managerStatus: decision,
          managerNotes: args.notes ?? null,
          reviewedAt: new Date(),
          status: "ACKNOWLEDGED" as const,
        };
  // Guarded on the status the decision starts from, so two people deciding
  // at once cannot both win: the second finds the row already moved and
  // gets WeeklyDecisionConflict (the route answers 409).
  const from = decision === "REOPEN" ? ("ACKNOWLEDGED" as const) : ("SUBMITTED" as const);
  const res = await prisma.weeklyReview.updateMany({ where: { id: reviewId, status: from }, data });
  if (res.count === 0) throw new WeeklyDecisionConflict();
  const updated = await prisma.weeklyReview.findUniqueOrThrow({ where: { id: reviewId } });
  return shapeFromRow(updated);
}
