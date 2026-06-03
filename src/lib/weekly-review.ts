// Weekly review — the heartbeat cadence. Helpers for:
//   - Computing the current week's ISO start (Monday 00:00 UTC).
//   - Get-or-create the user's DRAFT review for the current week.
//   - Submit a review (DRAFT → SUBMITTED with timestamp).
//
// We rely on Prisma's @@unique([userId, periodStart]) so upserts are
// race-free even if two tabs try to create simultaneously.

import { prisma } from "@/lib/prisma";

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

/**
 * Human label — "Jun 2 – Jun 8, 2026".
 */
export function formatWeekRange(start: Date): string {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getUTCFullYear()}`;
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
 * Get the user's review for the given week, creating a DRAFT if none
 * exists yet. The manager fk is inferred from the user's solid manager
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
  // manager changes mid-week, that's fine — the review keeps the
  // historical manager who is on the hook for this week's submission.
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { managerId: true },
  });

  const created = await prisma.weeklyReview.create({
    data: {
      organizationId: args.organizationId,
      userId: args.userId,
      periodStart,
      managerId: user?.managerId ?? null,
    },
  });
  return shapeFromRow(created);
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

/**
 * Submit a review for manager review. Idempotent — re-submitting a
 * SUBMITTED row just refreshes submittedAt. Sets managerStatus=PENDING
 * so the manager's queue shows it.
 */
export async function submitWeeklyReview(reviewId: string): Promise<WeeklyReviewDoc> {
  const updated = await prisma.weeklyReview.update({
    where: { id: reviewId },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      managerStatus: "PENDING",
    },
  });
  return shapeFromRow(updated);
}

/**
 * Reopen a SUBMITTED review back to DRAFT (e.g. manager requested
 * changes and the IC is editing). Caller side enforces that the IC
 * owns the review.
 */
export async function reopenWeeklyReview(reviewId: string): Promise<WeeklyReviewDoc> {
  const updated = await prisma.weeklyReview.update({
    where: { id: reviewId },
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
 * Reviews where the caller is the recorded `managerId`. Optionally
 * filtered by status. Includes the subject so the queue can render
 * who-and-when at a glance.
 */
export async function listReviewsForManager(
  managerId: string,
  opts: { status?: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED"; take?: number } = {},
): Promise<ManagerReviewQueueItem[]> {
  const rows = await prisma.weeklyReview.findMany({
    where: {
      managerId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: [{ submittedAt: "desc" }, { periodStart: "desc" }],
    take: opts.take ?? 100,
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
 * Manager action on a SUBMITTED review.
 *
 *   action = "approve"          → managerStatus=APPROVED, status=ACKNOWLEDGED
 *   action = "request_changes"  → managerStatus=CHANGES_REQUESTED, status=ACKNOWLEDGED
 *
 * Callers must already be verified as the review's manager (or have
 * org-admin override). We don't re-check ownership here; the API
 * layer is the gate.
 */
export async function actOnReview(
  reviewId: string,
  args: { action: "approve" | "request_changes"; notes?: string; actorId: string },
): Promise<WeeklyReviewDoc> {
  const next = args.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
  const updated = await prisma.weeklyReview.update({
    where: { id: reviewId },
    data: {
      managerStatus: next,
      managerNotes: args.notes ?? null,
      reviewedAt: new Date(),
      status: "ACKNOWLEDGED",
      // Preserve the actor as managerId even if the original record
      // was assigned to a different manager — keeps audit honest when
      // a director acts on a manager's behalf.
      managerId: args.actorId,
    },
  });
  return shapeFromRow(updated);
}
