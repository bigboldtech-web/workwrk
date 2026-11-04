// Weekly review, the heartbeat cadence. Helpers for:
//   - Computing the current week's ISO start (Monday 00:00 UTC).
//   - Get-or-create the user's DRAFT review for the current week.
//   - Submit a review (DRAFT → SUBMITTED with timestamp).
//
// We rely on Prisma's @@unique([userId, organizationId, periodStart]) so
// upserts are race-free even if two tabs try to create simultaneously.
//
// ONE ROW PER PERSON, WORKSPACE AND WEEK (docs/plans/workspace-status-2.md,
// the final review, security M1; prisma/sql/2026-11-04-week-rows-per-workspace.sql).
// Before, the key was the person and the week, so whichever workspace wrote
// a week first held it: Pat's B check-in was saved onto her A row and went
// to Max in A. Every lookup names the workspace now, and a row is read with
// only this workspace's KPI snapshots and KRA progress (entriesHere): a row
// written before may still hold another workspace's, kept on the row and
// never shown or counted here.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { effectiveManagerOf, managesNobody, reportsThroughAgents } from "@/lib/access/manager-lines";
import { reportsHereOf } from "@/lib/access/acting-workspace";

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
 * Of these KPI and KRA ids, the ones that belong to ANOTHER workspace than
 * `organizationId` (one deleted since is not among them, so it still reads
 * "A removed KPI" where it is shown).
 */
async function idsElsewhere(organizationId: string, kpiIds: readonly string[], kraIds: readonly string[]): Promise<{ kpis: Set<string>; kras: Set<string> }> {
  const [kpis, kras] = await Promise.all([
    kpiIds.length ? prisma.kPI.findMany({ where: { id: { in: [...new Set(kpiIds)] }, organizationId: { not: organizationId } }, select: { id: true } }) : Promise.resolve([]),
    kraIds.length ? prisma.kRA.findMany({ where: { id: { in: [...new Set(kraIds)] }, organizationId: { not: organizationId } }, select: { id: true } }) : Promise.resolve([]),
  ]);
  return { kpis: new Set(kpis.map((k) => k.id)), kras: new Set(kras.map((k) => k.id)) };
}

/**
 * Week rows as their own workspace reads them (docs/plans/workspace-status-2.md,
 * the final review, security M1): each row's KPI snapshots and KRA progress,
 * each with its note, only for KPIs and KRAs of the row's workspace. A row
 * written while one row served every workspace may hold another
 * workspace's (Pat's B KPIs on her A row): they stay on the row, never shown
 * or counted here. Every reader of a person's week reads this workspace's
 * row (by person, workspace and week), so the row's workspace is the one it
 * is read in.
 */
export async function entriesHere<T extends Pick<WeeklyReviewDoc, "organizationId" | "kpiSnapshots" | "kraProgress">>(docs: readonly T[]): Promise<T[]> {
  const byOrg = new Map<string, T[]>();
  for (const d of docs) byOrg.set(d.organizationId, [...(byOrg.get(d.organizationId) ?? []), d]);
  const out = new Map<T, T>();
  for (const [organizationId, group] of byOrg) {
    const elsewhere = await idsElsewhere(
      organizationId,
      group.flatMap((d) => d.kpiSnapshots.map((k) => k.kpiId)),
      group.flatMap((d) => d.kraProgress.map((k) => k.kraId)),
    );
    for (const d of group) {
      out.set(d, {
        ...d,
        kpiSnapshots: d.kpiSnapshots.filter((k) => !elsewhere.kpis.has(k.kpiId)),
        kraProgress: d.kraProgress.filter((k) => !elsewhere.kras.has(k.kraId)),
      });
    }
  }
  return docs.map((d) => out.get(d)!);
}

/** A week row by id as its own workspace reads it (entriesHere), or null. */
export async function weeklyReviewHere(reviewId: string): Promise<WeeklyReviewDoc | null> {
  const row = await prisma.weeklyReview.findUnique({ where: { id: reviewId } });
  return row ? docHere(row) : null;
}

/** One row read here (entriesHere). */
async function docHere(row: Parameters<typeof shapeFromRow>[0]): Promise<WeeklyReviewDoc> {
  return (await entriesHere([shapeFromRow(row)]))[0];
}

/**
 * Read the user's review for the given week, or null. Never writes: every
 * GET and page render uses this, and the row is created by the first save
 * (POST /api/me/weekly-review), so opening the page leaves no empty DRAFT.
 */
export async function findWeeklyReview(args: {
  userId: string;
  /** The workspace it is read in: a person has one row per workspace and week. */
  organizationId: string;
  periodStart?: Date;
}): Promise<WeeklyReviewDoc | null> {
  const periodStart = args.periodStart ?? weekStartFor();
  const row = await prisma.weeklyReview.findUnique({
    where: { userId_organizationId_periodStart: { userId: args.userId, organizationId: args.organizationId, periodStart } },
  });
  return row ? docHere(row) : null;
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

  // This workspace's row of the week (one per person, workspace and week).
  const existing = await prisma.weeklyReview.findUnique({
    where: { userId_organizationId_periodStart: { userId: args.userId, organizationId: args.organizationId, periodStart } },
  });
  if (existing) return docHere(existing);

  // Inherit manager from User.managerId at create time. If the user's
  // manager changes mid-week, that's fine, the review keeps the
  // historical manager who is on the hook for this week's submission.
  // Never an Agent, who is nobody's manager: past one, the next manager up
  // (src/lib/access/manager-lines.ts effectiveManagerOf).
  const managerId = await effectiveManagerOf(args.organizationId, args.userId);

  try {
    const created = await prisma.weeklyReview.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        periodStart,
        managerId,
      },
    });
    return docHere(created);
  } catch (err) {
    // Two first saves raced (two tabs): the other one created the row, so
    // answer with it instead of a 500.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const row = await prisma.weeklyReview.findUnique({
      where: { userId_organizationId_periodStart: { userId: args.userId, organizationId: args.organizationId, periodStart } },
    });
    if (!row) throw err;
    return docHere(row);
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
  // The entries this workspace never shows (another workspace's, written on
  // this row before the rows were per workspace) are kept as they are: a
  // save replaces only what the person could see (entriesHere), so nothing
  // they never saw is lost.
  const kept = patch.kpiSnapshots !== undefined || patch.kraProgress !== undefined ? await hiddenEntriesOf(reviewId) : null;
  if (patch.kpiSnapshots !== undefined) {
    const sent = new Set(patch.kpiSnapshots.map((k) => k.kpiId));
    data.kpiSnapshots = [...patch.kpiSnapshots, ...(kept?.kpiSnapshots ?? []).filter((k) => !sent.has(k.kpiId))] as object;
  }
  if (patch.kraProgress !== undefined) {
    const sent = new Set(patch.kraProgress.map((k) => k.kraId));
    data.kraProgress = [...patch.kraProgress, ...(kept?.kraProgress ?? []).filter((k) => !sent.has(k.kraId))] as object;
  }
  if (patch.highlights !== undefined) data.highlights = patch.highlights;
  if (patch.blockers !== undefined) data.blockers = patch.blockers;
  if (patch.plan !== undefined) data.plan = patch.plan;
  const updated = await prisma.weeklyReview.update({ where: { id: reviewId }, data });
  return docHere(updated);
}

/** The entries of a row its own workspace does not read (another workspace's KPIs and KRAs): what a save must keep. */
async function hiddenEntriesOf(reviewId: string): Promise<{ kpiSnapshots: KpiSnapshot[]; kraProgress: KraProgressEntry[] } | null> {
  const row = await prisma.weeklyReview.findUnique({ where: { id: reviewId }, select: { organizationId: true, kpiSnapshots: true, kraProgress: true } });
  if (!row) return null;
  const kpiSnapshots = Array.isArray(row.kpiSnapshots) ? (row.kpiSnapshots as unknown as KpiSnapshot[]) : [];
  const kraProgress = Array.isArray(row.kraProgress) ? (row.kraProgress as unknown as KraProgressEntry[]) : [];
  const elsewhere = await idsElsewhere(row.organizationId, kpiSnapshots.map((k) => k.kpiId), kraProgress.map((k) => k.kraId));
  return { kpiSnapshots: kpiSnapshots.filter((k) => elsewhere.kpis.has(k.kpiId)), kraProgress: kraProgress.filter((k) => elsewhere.kras.has(k.kraId)) };
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
  // The manager as an Agent-free line reads it (an Agent is nobody's
  // manager; manager-lines.ts effectiveManagerOf).
  const row = await prisma.weeklyReview.findUnique({ where: { id: reviewId }, select: { userId: true, organizationId: true } });
  const managerId = row ? await effectiveManagerOf(row.organizationId, row.userId) : null;
  const updated = await prisma.weeklyReview.update({
    where: { id: reviewId },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      managerStatus: "PENDING",
      ...(managerId ? { managerId } : {}),
    },
  });
  return docHere(updated);
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
  return docHere(updated);
}

/**
 * List recent reviews for a user (history feed). Newest first.
 */
export async function listMyWeeklyReviews(userId: string, organizationId: string, opts: { take?: number } = {}): Promise<WeeklyReviewDoc[]> {
  // This workspace's weeks only (one row per person, workspace and week).
  const rows = await prisma.weeklyReview.findMany({
    where: { userId, organizationId },
    orderBy: { periodStart: "desc" },
    take: opts.take ?? 24,
  });
  return entriesHere(rows.map(shapeFromRow));
}

// ── Manager surface ───────────────────────────────────────────────

export interface ManagerReviewQueueItem extends WeeklyReviewDoc {
  subject: { id: string; firstName: string; lastName: string; email: string; avatar: string | null } | null;
}

/**
 * Whose weekly reviews a manager's queue holds: the people who report to
 * them NOW, whoever was recorded on the row when it was submitted, plus rows
 * recorded to them whose subject has no manager today. A report who moved
 * takes their pending review to the new manager (the old one no longer sees
 * it or decides it), and nobody's review is left in a queue nobody reads.
 *
 * NOW is THIS workspace's line (docs/plans/workspace-status-2.md E1, step
 * 2): `reports` are the people whose line here names the manager
 * (acting-workspace.ts reportsHereOf: the account's line for people
 * anchored here, the membership's otherwise), and "no manager today" is no
 * line here (noLineHere). Before, the subject's account line, so Pat's B
 * review went to Max's queue in B through her line in A, never to Dana's.
 *
 * `lifted` are people listed under one of this manager's Agent reports, who
 * report to this manager in effect (an Agent is nobody's manager;
 * manager-lines.ts). Callers outside this file use managerQueueWhereFor,
 * which reads both and answers nothing for an Agent.
 */
export function managerQueueWhere(
  managerId: string,
  organizationId: string,
  reports: readonly string[],
  lifted: readonly string[] = [],
): Prisma.WeeklyReviewWhereInput {
  const people = [...new Set([...reports, ...lifted])];
  return {
    OR: [
      ...(people.length ? [{ userId: { in: people }, user: { deletedAt: null } }] : []),
      { managerId, user: noLineHere(organizationId) },
    ],
  };
}

/**
 * A person with no line HERE, not removed (E1): anchored here with no
 * account line, or here through a membership, not removed, with none on it.
 */
function noLineHere(organizationId: string): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    OR: [
      { organizationId, managerId: null },
      { organizationId: { not: organizationId }, organizationMemberships: { some: { organizationId, removedAt: null, managerId: null } } },
    ],
  };
}

/** Matches no weekly review: the queue of someone who manages nobody. */
const NO_REVIEW: Prisma.WeeklyReviewWhereInput = { id: { in: [] } };

/**
 * The direct queue as an Agent-free line reads it: nothing for an Agent
 * (whatever lines stored before rule 6 still name them), and the people
 * listed under an Agent report join their manager's queue.
 */
export async function managerQueueWhereFor(managerId: string, organizationId: string): Promise<Prisma.WeeklyReviewWhereInput> {
  if (await managesNobody(managerId, organizationId)) return NO_REVIEW;
  const [reports, lifted] = await Promise.all([
    reportsHereOf(organizationId, [managerId]).then((rows) => rows.map((r) => r.id)),
    reportsThroughAgents(organizationId, managerId),
  ]);
  return { AND: [{ organizationId }, managerQueueWhere(managerId, organizationId, reports, lifted)] };
}

/**
 * How many weekly reviews await `managerId`'s decision: the SAME where clause
 * listReviewsForManager runs for the /team/reviews queue (status SUBMITTED),
 * uncapped, so the sidebar badge and the queue can never disagree.
 */
export async function countReviewsAwaitingManager(managerId: string, organizationId: string): Promise<number> {
  return prisma.weeklyReview.count({ where: { AND: [await managerQueueWhereFor(managerId, organizationId), { status: "SUBMITTED" }] } });
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
export async function chainQueueWhere(managerId: string, organizationId: string): Promise<Prisma.WeeklyReviewWhereInput> {
  const [tree, direct] = await Promise.all([
    getEffectiveReportTree(managerId, { organizationId }).then((ids) => ids.filter((id) => id !== managerId)),
    managerQueueWhereFor(managerId, organizationId),
  ]);
  return tree.length
    ? { OR: [direct, { userId: { in: tree }, organizationId, user: { deletedAt: null } }] }
    : direct;
}

/** How many weekly reviews in the viewer's chain await a decision (uncapped). */
export async function countChainReviewsAwaiting(managerId: string, organizationId: string): Promise<number> {
  return prisma.weeklyReview.count({ where: { AND: [await chainQueueWhere(managerId, organizationId), { status: "SUBMITTED" }] } });
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
  organizationId: string,
  opts: { status?: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" } = {},
): Promise<number> {
  return prisma.weeklyReview.count({
    where: { AND: [await managerQueueWhereFor(managerId, organizationId), opts.status ? { status: opts.status } : {}] },
  });
}

export async function listReviewsForManager(
  managerId: string,
  organizationId: string,
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
  const direct = await managerQueueWhereFor(managerId, organizationId);
  // The rows the caller decided, of this workspace only: they may have
  // decided a review in another workspace they also manage in.
  const population: Prisma.WeeklyReviewWhereInput = decidedIds.length
    ? { OR: [direct, { id: { in: decidedIds }, organizationId }] }
    : direct;
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

  const docs = await entriesHere(rows.map(shapeFromRow));
  return docs.map((d) => ({
    ...d,
    subject: byId.get(d.userId) ?? null,
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
  // The recorded manager reads it, unless they are an Agent (nobody's manager).
  if (row.userId !== viewerId && (row.managerId !== viewerId || (await managesNobody(viewerId, row.organizationId)))) return null;
  const subject = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  });
  return { ...(await docHere(row)), subject };
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
  return docHere(updated);
}
