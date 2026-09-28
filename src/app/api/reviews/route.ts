// /api/reviews: the Review cycles list (spec-teams-performance /reviews).
//
// GET  ?view=active|draft|completed|all  &status=  &type=  &from=&to=
//      &by={userId}  &audience=ALL|USERS|{departmentId}  &q=
//      &sort=newest|name|closing|least  &page=&limit=
//      -> { data: CycleRow[], pagination: { total, page, limit } }
//      Counts are server computed over the rows the viewer may read, never
//      over a page of rows. Cycles a viewer holds nothing in are not listed
//      (the same answer as the cycle page's 404), except to their starter.
// GET  ?subjectId={userId}: one person's review rows (the profile's Reviews
//      tab): the person themself, anyone above them in the chain, the
//      People team and Admin. A subject reads their own manager fields only
//      once the review is completed.
// POST { name, type, startDate, endDate, audienceType?, departmentIds?,
//      userIds? }: start a cycle (DECIDED: a manager may run one for their
//      chain; launch always clips a manager's cycle to their chain).
// PATCH { id, name?, type?, startDate?, endDate?, status? }: edit, or the
//      named moves (Start calibration). Completed is reached only by
//      finalize, Active only by launch (review-cycle.ts transitions).
// DELETE ?id=: the People team and Admin only (Cancel is everyone else's).

import { canManageReviewCycle, chainOf, isPeopleTeamOrAdmin, mayStartReviewCycles } from "@/lib/people/review-cycle-access";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import type { Prisma, CycleStatus } from "@/generated/prisma";
import { cycleCounts, cycleViewerCtx } from "@/lib/performance/review-cycle.server";
import { cycleTransitionBlocked, CYCLE_TYPES } from "@/lib/performance/review-cycle";
import { subjectRowView } from "@/lib/people/review-visibility";
import { can } from "@/lib/access/index";
import { viewerFromSession } from "@/lib/access/viewer";

const VIEW_STATUSES: Record<string, CycleStatus[] | null> = {
  active: ["ACTIVE", "IN_CALIBRATION"],
  draft: ["DRAFT"],
  completed: ["COMPLETED", "CANCELLED"],
  all: null,
};
const STATUS_SET = new Set(["DRAFT", "ACTIVE", "IN_CALIBRATION", "COMPLETED", "CANCELLED"]);
const TYPE_SET = new Set(CYCLE_TYPES.map((t) => t.value));
type CycleType = Prisma.ReviewCycleCreateInput["type"];

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await cycleViewerCtx();
  if (!ctx || ctx.isGuest) return jsonError("Not found", 404);
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;

  // ── One person's reviews (the profile's Reviews tab) ──────────────
  const subjectId = sp.get("subjectId");
  if (subjectId) {
    const self = subjectId === ctx.userId;
    if (!self && !ctx.peopleTeamOrAdmin && !ctx.chain.has(subjectId)) return jsonError("Not found", 404);
    const rows = await prisma.review.findMany({
      where: { subjectId, cycle: { organizationId: orgId, status: { not: "DRAFT" } } },
      include: { cycle: { select: { id: true, name: true, status: true, startDate: true, endDate: true } } },
      orderBy: { createdAt: "desc" },
    });
    return jsonSuccess({
      data: rows.map((r) => {
        const v = (self ? subjectRowView(r as unknown as Record<string, unknown>, ctx.userId) : r) as Record<string, unknown>;
        return {
          id: r.id,
          cycleId: r.cycle.id,
          cycleName: r.cycle.name,
          cycleStartsAt: r.cycle.startDate,
          calibratedScore: v.calibratedScore ?? null,
          cycleStatus: r.cycle.status,
          status: r.status,
          selfRatings: r.selfRatings,
          managerRating: v.managerRating ?? null,
          overallScore: v.overallScore ?? null,
          outcome: v.outcome ?? null,
          closesAt: r.cycle.endDate,
        };
      }),
    });
  }

  // The cycle list itself (and its CSV, which reads through here) is the
  // Review cycles page's: whoever holds app:reviews (reports over their
  // chain, the People team, Admin), the same answer as the page's 404. A
  // subject reaches their own review by the ?subjectId= door above and the
  // cycle link they are sent.
  {
    const v = await viewerFromSession();
    const d = v ? await can(v, "view", { type: "app", key: "reviews" }) : null;
    if (!d?.discoverable) return jsonError("Not found", 404);
  }

  const viewParam = sp.get("view") ?? "active";
  const view = viewParam in VIEW_STATUSES ? viewParam : "active";
  const status = sp.get("status");
  const types = (sp.get("type") ?? "").split(",").filter((t) => TYPE_SET.has(t));
  const q = (sp.get("q") ?? sp.get("search") ?? "").trim().slice(0, 200);
  const from = sp.get("from");
  const to = sp.get("to");
  const by = sp.get("by");
  const sort = sp.get("sort") ?? "newest";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? "40") || 40));

  const where: Prisma.ReviewCycleWhereInput = { organizationId: orgId };
  const and: Prisma.ReviewCycleWhereInput[] = [];
  if (status && STATUS_SET.has(status)) where.status = status as CycleStatus;
  else if (VIEW_STATUSES[view]) where.status = { in: VIEW_STATUSES[view]! };
  if (types.length) where.type = { in: types as NonNullable<CycleType>[] };
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (by) where.createdById = by;
  const audience = sp.get("audience");
  if (audience === "ALL" || audience === "USERS") where.audienceType = audience;
  else if (audience) where.departmentIds = { has: audience };
  if (from && !Number.isNaN(Date.parse(from))) and.push({ endDate: { gte: new Date(from) } });
  if (to && !Number.isNaN(Date.parse(to))) and.push({ startDate: { lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`) } });

  // Below the People team and Admin: only cycles the viewer is IN (their
  // own review, ones they review, their chain's), or started themselves.
  let reviewsWhere: Prisma.ReviewWhereInput | undefined;
  if (!ctx.peopleTeamOrAdmin) {
    const subjectIds = [ctx.userId, ...ctx.chain];
    reviewsWhere = { OR: [{ subjectId: { in: subjectIds } }, { reviewerId: ctx.userId }] };
    and.push({ OR: [{ reviews: { some: reviewsWhere } }, { createdById: ctx.userId }] });
  }
  if (and.length) where.AND = and;

  const cycles = await prisma.reviewCycle.findMany({
    where,
    select: {
      id: true, name: true, type: true, status: true, startDate: true, endDate: true,
      audienceType: true, departmentIds: true, userIds: true, createdById: true, createdAt: true,
    },
    orderBy: { startDate: "desc" },
  });
  const counts = await cycleCounts(cycles.map((c) => c.id), reviewsWhere);

  // Least complete sorts on the server's own counts, so it is computed over
  // every matching cycle before paging (an org holds dozens, not thousands).
  const ratio = (id: string) => { const c = counts.get(id); return c && c.total ? c.completed / c.total : 1; };
  const sorted = [...cycles];
  if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "closing") sorted.sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
  else if (sort === "least") sorted.sort((a, b) => ratio(a.id) - ratio(b.id));
  const total = sorted.length;
  const pageRows = sorted.slice((page - 1) * limit, page * limit);

  const deptIds = [...new Set(pageRows.flatMap((c) => c.departmentIds))];
  const creatorIds = [...new Set(pageRows.map((c) => c.createdById).filter((x): x is string => !!x))];
  const [depts, creators] = await Promise.all([
    deptIds.length ? prisma.department.findMany({ where: { id: { in: deptIds }, organizationId: orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
    creatorIds.length ? prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name] as const));
  const creatorById = new Map(creators.map((u) => [u.id, u] as const));

  const data = pageRows.map((c) => {
    const creator = c.createdById ? creatorById.get(c.createdById) : undefined;
    const covers =
      c.audienceType === "DEPARTMENTS"
        ? c.departmentIds.map((d) => deptName.get(d)).filter(Boolean).join(", ") || "Departments"
        : c.audienceType === "USERS"
          ? `${c.userIds.length} ${c.userIds.length === 1 ? "person" : "people"}`
          : "Everyone";
    return {
      ...c,
      covers,
      createdBy: creator ? { id: creator.id, name: `${creator.firstName} ${creator.lastName}`.trim() } : null,
      counts: counts.get(c.id) ?? { total: 0, selfDone: 0, managerDone: 0, calibrated: 0, completed: 0 },
      canManage: ctx.peopleTeamOrAdmin || (!!c.createdById && c.createdById === ctx.userId),
    };
  });

  return jsonSuccess({ data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasMore: page * limit < total } });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayStartReviewCycles(session))) return jsonError("Forbidden", 403);

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type : "";
  const startDate = typeof body.startDate === "string" ? body.startDate : "";
  const endDate = typeof body.endDate === "string" ? body.endDate : "";

  if (!name || !type || !startDate || !endDate) {
    return jsonError("Name, type, start date and end date are required");
  }
  if (!TYPE_SET.has(type)) return jsonError("Unknown cycle type");
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return jsonError("Dates must be real dates");
  if (end < start) return jsonError("The cycle must end on or after the day it starts");

  // Audience: Everyone, some departments, or named people. A manager's cycle
  // is clipped to their chain at launch whatever it says (launchAudience),
  // so a manager can never open a review for somebody else's people.
  const orgId = getOrgId(session);
  const audienceType = body.audienceType === "DEPARTMENTS" || body.audienceType === "USERS" ? body.audienceType : "ALL";
  const asIds = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 2000) : []);
  let departmentIds: string[] = [];
  let userIds: string[] = [];
  if (audienceType === "DEPARTMENTS") {
    const ok = await prisma.department.findMany({ where: { id: { in: asIds(body.departmentIds) }, organizationId: orgId }, select: { id: true } });
    departmentIds = ok.map((d) => d.id);
    if (!departmentIds.length) return jsonError("Pick at least one department");
  }
  if (audienceType === "USERS") {
    const ok = await prisma.user.findMany({ where: { id: { in: asIds(body.userIds) }, organizationId: orgId, deletedAt: null }, select: { id: true } });
    userIds = ok.map((u) => u.id);
    if (!userIds.length) return jsonError("Pick at least one person");
  }
  const peopleOrAdmin = await isPeopleTeamOrAdmin(session);
  if (!peopleOrAdmin && audienceType === "USERS") {
    const chain = new Set(await chainOf(getUserId(session)));
    userIds = userIds.filter((id) => chain.has(id));
    if (!userIds.length) return jsonError("Pick people who report to you");
  }

  const cycle = await prisma.reviewCycle.create({
    data: {
      name: name.slice(0, 200),
      type: type as NonNullable<CycleType>,
      startDate: start,
      endDate: end,
      organizationId: orgId,
      createdById: getUserId(session),
      audienceType,
      departmentIds,
      userIds,
    },
  });

  logActivity({
    type: "review_cycle.create",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Created review cycle: ${cycle.name}`,
    targetId: cycle.id,
    targetType: "ReviewCycle",
    metadata: { name: cycle.name, type, startDate, endDate, audienceType },
  });

  return jsonSuccess(cycle, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, string | undefined>;
  const { id, name, type, startDate, endDate, status } = body;

  if (!id) return jsonError("Cycle id is required");

  const existing = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("Review cycle not found", 404);
  // Phase 6: the People team and Admin, or the manager who started it.
  if (!(await canManageReviewCycle(session, existing))) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can change it", 403);
  }
  if (status !== undefined && !STATUS_SET.has(status)) return jsonError("Unknown status", 400);
  if (type !== undefined && !TYPE_SET.has(type)) return jsonError("Unknown cycle type", 400);
  // The named moves only (review-cycle.ts): no raw "Move to next", no
  // Completed by hand, no reopening a closed cycle.
  if (status !== undefined) {
    const blocked = cycleTransitionBlocked(existing.status, status);
    if (blocked) return jsonError(blocked, 409);
  }
  if ((existing.status === "COMPLETED" || existing.status === "CANCELLED") && (name !== undefined || type !== undefined || startDate !== undefined || endDate !== undefined)) {
    return jsonError("This cycle is closed. Scores and outcomes are final.", 409);
  }

  const cycle = await prisma.reviewCycle.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: String(name).trim().slice(0, 200) || existing.name }),
      ...(type !== undefined && { type: type as NonNullable<CycleType> }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(status !== undefined && { status: status as CycleStatus }),
    },
  });

  logActivity({
    type: "review_cycle.update",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: status && status !== existing.status ? `Moved review cycle ${cycle.name} to ${status.toLowerCase().replace(/_/g, " ")}` : `Updated review cycle: ${cycle.name}`,
    targetId: cycle.id,
    targetType: "ReviewCycle",
    metadata: {
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(status !== undefined && { status, previousStatus: existing.status }),
    },
  });

  return jsonSuccess(cycle);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("Cycle id is required");

  const existing = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("Review cycle not found", 404);
  // Deleting a cycle deletes every review in it: the People team and Admin
  // only, never the manager who started it (Cancel is theirs), never an
  // Agent (cap.agent.delete).
  const ctx = await cycleViewerCtx();
  if (!(await isPeopleTeamOrAdmin(session)) || ctx?.isAgent) {
    return jsonError("Only the People team or an Admin can delete a review cycle", 403);
  }

  // Appraisal history is never destroyed: only a cycle nobody has a review
  // in yet (a Draft, or one that never launched) can go. Once reviews exist,
  // Cancel is the path, and it keeps every row.
  const written = await prisma.review.count({ where: { cycleId: id } });
  if (existing.status !== "DRAFT" || written > 0) {
    return jsonError("Only a draft cycle with no reviews can be deleted. Cancel this cycle instead: it keeps every review.", 409);
  }

  await prisma.reviewCycle.delete({ where: { id } });
  logActivity({
    type: "review_cycle.delete",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Deleted review cycle: ${existing.name}`,
    targetId: existing.id,
    targetType: "ReviewCycle",
  });

  return jsonSuccess({ message: "Review cycle deleted" });
}
