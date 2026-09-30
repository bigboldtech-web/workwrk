// The /team/reviews queue on the server (spec-teams-performance
// /team/reviews Data): GET /api/weekly-reviews and the drawer's
// GET /api/weekly-reviews/[id] both read through here, so the list and the
// drawer can never disagree about who may see a review.
//
// Who is in the population (the `weekly-reviews` APP_RULES row):
//   direct   the people who report to the viewer now (managerQueueWhere,
//            the sidebar badge's own clause)
//   chain    everyone below the viewer, solid any depth plus dotted
//            (chainQueueWhere); for the People team and Admin, the org
// The viewer's own review is never in it, and neither is a removed person.
//
// Names, never ids (PO-9): KRA and KPI names are joined here; a KRA or KPI
// that was deleted since reads "A removed KRA" rather than a raw id.
//
// Server only.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { chainQueueWhere, managerQueueWhere, type KpiSnapshot, type KraProgressEntry } from "@/lib/weekly-review";
import {
  ACTED_DAYS,
  WEEKLY_PAGE_SIZE,
  firstLine,
  kpiSnapshotTone,
  statusClause,
  weekKey,
  weeklyKraSummary,
  weeklyStatusOf,
  type WeeklyQuery,
  type WeeklyScope,
} from "./weekly-queue";

export interface WeeklyQueueCtx {
  userId: string;
  organizationId: string;
  peopleTeamOrAdmin: boolean;
  isAgent: boolean;
  hasReports: boolean;
  /** The viewer's tree, solid plus dotted, self excluded (the decision gate's). */
  tree: Set<string>;
}

export async function weeklyQueueCtx(): Promise<WeeklyQueueCtx | null> {
  const v = await viewerFromSession();
  if (!v || v.orgRole === "GUEST") return null;
  const tree = new Set((await getEffectiveReportTree(v.userId)).filter((id) => id !== v.userId));
  return {
    userId: v.userId,
    organizationId: v.organizationId,
    peopleTeamOrAdmin: v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true,
    isAgent: v.isAgent,
    hasReports: tree.size > 0,
    tree,
  };
}

/** May this viewer open the queue at all (the APP_RULES row's facts)? */
export function mayOpenQueue(ctx: WeeklyQueueCtx): boolean {
  return ctx.hasReports || ctx.peopleTeamOrAdmin;
}

/** The scope a request resolves to: what it asked for, or the viewer's default. */
export function resolveScope(ctx: WeeklyQueueCtx, asked: WeeklyScope | null): WeeklyScope {
  if (asked) return asked;
  return ctx.hasReports ? "direct" : "chain";
}

async function populationWhere(ctx: WeeklyQueueCtx, scope: WeeklyScope): Promise<Prisma.WeeklyReviewWhereInput> {
  const base: Prisma.WeeklyReviewWhereInput = {
    organizationId: ctx.organizationId,
    userId: { not: ctx.userId },
    user: { deletedAt: null },
  };
  if (scope === "direct") return { AND: [base, managerQueueWhere(ctx.userId)] };
  if (ctx.peopleTeamOrAdmin) return base;
  return { AND: [base, await chainQueueWhere(ctx.userId)] };
}

/** The rows the viewer decided themselves in the Acted window (a skip-level Approve). */
async function decidedByViewer(ctx: WeeklyQueueCtx, since: Date): Promise<string[]> {
  const logs = await prisma.activityLog.findMany({
    where: { organizationId: ctx.organizationId, actorId: ctx.userId, type: "weekly_review_decided", targetType: "weekly_review", createdAt: { gte: since } },
    select: { targetId: true },
  });
  return [...new Set(logs.map((l) => l.targetId).filter((x): x is string => !!x))];
}

/** Would PATCH /manager-review accept this viewer's decision on this subject? */
export function canDecideFor(ctx: WeeklyQueueCtx, row: { userId: string; managerId: string | null }, subjectManagerId: string | null): boolean {
  if (row.userId === ctx.userId) return false;
  if (ctx.peopleTeamOrAdmin || ctx.tree.has(row.userId)) return true;
  return row.managerId === ctx.userId && !subjectManagerId;
}

const SUBJECT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
  managerId: true,
  presenceStatus: true,
  presenceUntil: true,
  role: { select: { title: true } },
} as const;

export interface WeeklyQueueRow {
  id: string;
  userId: string;
  subject: { id: string; firstName: string; lastName: string; email: string; avatar: string | null; jobTitle: string | null; presenceStatus: string | null; presenceUntil: string | null };
  week: string;
  status: string;
  managerStatus: string | null;
  statusKey: string;
  statusLabel: string;
  statusTone: string;
  highlights: string;
  kras: { onTrack: number; total: number };
  submittedAt: string | null;
  reviewedAt: string | null;
  canDecide: boolean;
}

export async function listWeeklyQueue(ctx: WeeklyQueueCtx, q: WeeklyQuery, opts: { all?: boolean } = {}): Promise<{
  rows: WeeklyQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  scope: WeeklyScope;
  groups: Array<{ key: string; count: number }>;
}> {
  const scope = resolveScope(ctx, q.scope);
  const population = await populationWhere(ctx, scope);
  const since = new Date(Date.now() - ACTED_DAYS * 86_400_000);

  const viewClause: Prisma.WeeklyReviewWhereInput =
    q.view === "waiting"
      ? { status: "SUBMITTED" }
      : q.view === "acted"
        ? { status: "ACKNOWLEDGED", reviewedAt: { gte: since } }
        : {};
  let populationOrDecided: Prisma.WeeklyReviewWhereInput = population;
  if (q.view === "acted") {
    const decided = await decidedByViewer(ctx, since);
    if (decided.length) {
      populationOrDecided = {
        OR: [population, { id: { in: decided }, organizationId: ctx.organizationId, userId: { not: ctx.userId } }],
      };
    }
  }
  const statusWhere: Prisma.WeeklyReviewWhereInput = q.statuses.length
    ? { OR: q.statuses.map((s) => statusClause(s)) }
    : {};
  const text = q.q.trim();
  const textWhere: Prisma.WeeklyReviewWhereInput = text
    ? {
        OR: [
          { user: { firstName: { contains: text, mode: "insensitive" } } },
          { user: { lastName: { contains: text, mode: "insensitive" } } },
          { user: { email: { contains: text, mode: "insensitive" } } },
          // A draft's body is its author's alone: search never matches it, so
          // a manager cannot probe an unsubmitted draft word by word.
          { highlights: { contains: text, mode: "insensitive" }, status: { not: "DRAFT" } },
        ],
      }
    : {};
  const where: Prisma.WeeklyReviewWhereInput = {
    AND: [
      populationOrDecided,
      viewClause,
      statusWhere,
      textWhere,
      q.week ? { periodStart: new Date(`${q.week}T00:00:00.000Z`) } : {},
      q.person ? { userId: q.person } : {},
      q.ids.length ? { id: { in: q.ids } } : {},
    ],
  };

  const dateOrder: Prisma.SortOrder = q.sort === "newest" ? "desc" : "asc";
  const orderBy: Prisma.WeeklyReviewOrderByWithRelationInput[] = [];
  if (q.group === "person" || q.sort === "person") orderBy.push({ user: { firstName: "asc" } }, { user: { lastName: "asc" } }, { userId: "asc" });
  if (q.group === "week") orderBy.push({ periodStart: "desc" });
  orderBy.push(
    q.view === "acted" ? { reviewedAt: q.sort === "oldest" ? "asc" : "desc" } : { submittedAt: dateOrder },
    { periodStart: dateOrder },
    { id: "asc" },
  );

  const pageSize = WEEKLY_PAGE_SIZE;
  const [total, rows, grouped] = await Promise.all([
    prisma.weeklyReview.count({ where }),
    prisma.weeklyReview.findMany({
      where,
      orderBy,
      ...(opts.all ? {} : { skip: (q.page - 1) * pageSize, take: pageSize }),
      select: {
        id: true, userId: true, periodStart: true, status: true, managerStatus: true, managerId: true,
        highlights: true, kraProgress: true, submittedAt: true, reviewedAt: true,
        user: { select: SUBJECT_SELECT },
      },
    }),
    q.group === "person"
      ? prisma.weeklyReview.groupBy({ by: ["userId"], where, _count: { _all: true } })
      : q.group === "week"
        ? prisma.weeklyReview.groupBy({ by: ["periodStart"], where, _count: { _all: true } })
        : Promise.resolve([]),
  ]);

  const out: WeeklyQueueRow[] = rows.map((r) => {
    const st = weeklyStatusOf(r);
    const draft = r.status === "DRAFT";
    return {
      id: r.id,
      userId: r.userId,
      subject: {
        id: r.user.id,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        email: r.user.email,
        avatar: r.user.avatar,
        jobTitle: r.user.role?.title ?? null,
        presenceStatus: r.user.presenceStatus ?? null,
        presenceUntil: r.user.presenceUntil ? r.user.presenceUntil.toISOString() : null,
      },
      week: weekKey(r.periodStart),
      status: r.status,
      managerStatus: r.managerStatus,
      statusKey: st.key,
      statusLabel: st.label,
      statusTone: st.tone,
      // A draft is the author's unfinished writing: nothing of it leaves.
      highlights: draft ? "" : firstLine(r.highlights),
      kras: draft ? { onTrack: 0, total: 0 } : weeklyKraSummary(Array.isArray(r.kraProgress) ? (r.kraProgress as Array<{ progressPct?: unknown }>) : []),
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      canDecide: canDecideFor(ctx, r, r.user.managerId ?? null),
    };
  });

  const groups = (grouped as Array<{ userId?: string; periodStart?: Date; _count: { _all: number } }>).map((g) => ({
    key: g.userId ?? (g.periodStart ? weekKey(g.periodStart) : ""),
    count: g._count._all,
  }));

  return { rows: out, total, page: q.page, pageSize, scope, groups };
}

export interface WeeklyReviewDetail {
  id: string;
  userId: string;
  subject: WeeklyQueueRow["subject"];
  manager: { id: string; firstName: string; lastName: string } | null;
  week: string;
  status: string;
  managerStatus: string | null;
  statusLabel: string;
  statusTone: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  decidedBy: { id: string; name: string } | null;
  managerNotes: string | null;
  /** Null for a draft: the body is the author's until they submit it. */
  body: {
    kras: Array<{ kraId: string; name: string; progressPct: number | null; note: string | null }>;
    kpis: Array<{ kpiId: string; name: string; value: number | null; target: number | null; unit: string | null; note: string | null; tone: string; toneLabel: string }>;
    highlights: string | null;
    blockers: string | null;
    plan: string | null;
  } | null;
  canDecide: boolean;
  /** The viewer is deciding for someone else's report (People team, Admin). */
  decidingForManager: boolean;
}

/**
 * One review for the drawer, or null when the viewer may not read it (the
 * route answers 404, so a review's existence is never confirmed). Readers:
 * the subject, the recorded manager, anyone in the tree above the subject,
 * the People team and Admin, and whoever decided it.
 */
export async function readWeeklyReview(ctx: WeeklyQueueCtx, id: string): Promise<WeeklyReviewDetail | null> {
  const row = await prisma.weeklyReview.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      user: { select: { ...SUBJECT_SELECT, deletedAt: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!row) return null;
  const isSubject = row.userId === ctx.userId;
  const lastDecision = await prisma.activityLog.findFirst({
    where: { organizationId: ctx.organizationId, type: "weekly_review_decided", targetId: row.id },
    orderBy: { createdAt: "desc" },
    select: { actorId: true, metadata: true },
  });
  const decidedByMe = lastDecision?.actorId === ctx.userId;
  const readable = isSubject || row.managerId === ctx.userId || ctx.peopleTeamOrAdmin || ctx.tree.has(row.userId) || decidedByMe;
  if (!readable) return null;
  if (!isSubject && row.user.deletedAt) return null;

  const draft = row.status === "DRAFT";
  const kraRows = (Array.isArray(row.kraProgress) ? row.kraProgress : []) as unknown as KraProgressEntry[];
  const kpiRows = (Array.isArray(row.kpiSnapshots) ? row.kpiSnapshots : []) as unknown as KpiSnapshot[];
  const [kras, kpis] = draft && !isSubject
    ? [[], []]
    : await Promise.all([
        kraRows.length
          ? prisma.kRA.findMany({ where: { id: { in: kraRows.map((k) => k.kraId).filter(Boolean) }, organizationId: ctx.organizationId }, select: { id: true, name: true } })
          : Promise.resolve([]),
        kpiRows.length
          ? prisma.kPI.findMany({
              where: { id: { in: kpiRows.map((k) => k.kpiId).filter(Boolean) }, organizationId: ctx.organizationId },
              select: { id: true, name: true, targetValue: true, unit: true, direction: true, lowerIsBetter: true },
            })
          : Promise.resolve([]),
      ]);
  const kraName = new Map(kras.map((k) => [k.id, k.name] as const));
  const kpiById = new Map(kpis.map((k) => [k.id, k] as const));

  let decidedBy: WeeklyReviewDetail["decidedBy"] = null;
  const lastMeta = lastDecision?.metadata as { decision?: string } | null;
  if (lastDecision?.actorId && lastMeta?.decision !== "REOPEN" && row.status === "ACKNOWLEDGED") {
    const who = await prisma.user.findUnique({ where: { id: lastDecision.actorId }, select: { id: true, firstName: true, lastName: true } });
    if (who) decidedBy = { id: who.id, name: `${who.firstName} ${who.lastName}`.trim() };
  }

  const st = weeklyStatusOf(row);
  const canDecide = !isSubject && canDecideFor(ctx, row, row.user.managerId ?? null);
  const directManagerId = row.user.managerId ?? row.managerId;
  return {
    id: row.id,
    userId: row.userId,
    subject: {
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      email: row.user.email,
      avatar: row.user.avatar,
      jobTitle: row.user.role?.title ?? null,
      presenceStatus: row.user.presenceStatus ?? null,
      presenceUntil: row.user.presenceUntil ? row.user.presenceUntil.toISOString() : null,
    },
    manager: row.manager,
    week: weekKey(row.periodStart),
    status: row.status,
    managerStatus: row.managerStatus,
    statusLabel: st.label,
    statusTone: st.tone,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    decidedBy,
    managerNotes: row.managerNotes,
    body: draft && !isSubject
      ? null
      : {
          kras: kraRows.map((k) => ({
            kraId: k.kraId,
            name: kraName.get(k.kraId) ?? "A removed KRA",
            progressPct: typeof k.progressPct === "number" ? Math.max(0, Math.min(100, Math.round(k.progressPct))) : null,
            note: k.note ?? null,
          })),
          kpis: kpiRows.map((k) => {
            const def = kpiById.get(k.kpiId);
            const tone = kpiSnapshotTone(k.value, def?.targetValue ?? null, (def?.direction as "HIGHER" | "LOWER" | "MAINTAIN" | null) ?? null, def?.lowerIsBetter ?? false);
            return {
              kpiId: k.kpiId,
              name: def?.name ?? "A removed KPI",
              value: typeof k.value === "number" ? k.value : null,
              target: def?.targetValue ?? null,
              unit: def?.unit ?? null,
              note: k.note ?? null,
              tone: tone.tone,
              toneLabel: tone.label,
            };
          }),
          highlights: row.highlights,
          blockers: row.blockers,
          plan: row.plan,
        },
    canDecide,
    decidingForManager: canDecide && !!directManagerId && directManagerId !== ctx.userId && !ctx.tree.has(row.userId),
  };
}
