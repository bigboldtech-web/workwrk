import { viewerFromSession } from "@/lib/access/viewer";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOrgAdminLevel, isOrgWideAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import {
  computeGoalRollups,
  enrichKeyResultGroups,
  enrichKeyResults,
  goalRollupFor,
  KR_KPI_SELECT,
  okrStatusFor,
  persistGoalRollupChain,
} from "@/lib/alignment";
import {
  addGoalAssignees,
  memberVisibilityOr,
  summarizeGoalAudiences,
  syncGoalAssignees,
  teamAudienceVisibilityOr,
  validateGoalAssignees,
  type GoalAudienceRef,
} from "@/lib/goal-audience";
import { getUserTagIds } from "@/lib/user-tags";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import type { GoalLevel, Prisma } from "@/generated/prisma";
import { filterGoals, orderGoals, paginate, parseGoalsListQuery } from "@/lib/goals/goal-list";
import { rollupVerdict, verdictForGoal, type GoalVerdict } from "@/lib/goal-verdict";
import { computeGoalEffortBatch, goalsWithLinkedWork, type GoalEffort } from "@/lib/goal-effort";
import { fiscalQuarterStart, goalQuarterLabel } from "@/lib/fiscal-quarter";

// OKR.level is the GoalLevel enum since the goals rebuild. Legacy
// clients may still send "TEAM", map it to DEPARTMENT, mirroring the
// goal_audience_kra_weight migration; anything unrecognised is null.
function normalizeGoalLevel(v: unknown): GoalLevel | null {
  const s = typeof v === "string" ? v.toUpperCase() : v;
  if (s === "TEAM") return "DEPARTMENT";
  return s === "COMPANY" || s === "DEPARTMENT" || s === "INDIVIDUAL" ? (s as GoalLevel) : null;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const q = parseGoalsListQuery(url.searchParams);
  const quarter = url.searchParams.get("quarter");
  const ownerId = url.searchParams.get("ownerId");
  // Views (spec-goals /okrs): My goals = goals the caller owns or is a
  // resolved contributor on (their user row, department, job title, tags),
  // plus their department's goals; Team goals = the report tree (the org for
  // org-wide levels); Company goals = level COMPANY. The retired ?mine=1,
  // ?team=1 and ?level=company map onto them (parseGoalsListQuery).
  const mineOnly = q.view === "mine";
  const teamOnly = q.view === "team";
  // ?withEffort=1: attach the per-goal effort summary (hours, open tasks,
  // last activity) from every piece of linked work. Team goals reads it.
  const withEffort = url.searchParams.get("withEffort") === "1";

  const where: Prisma.OKRWhereInput = { organizationId: orgId };
  const and: Prisma.OKRWhereInput[] = [];
  if (q.view === "company") where.level = "COMPANY";
  if (quarter) {
    and.push({ OR: [{ quarter }, { quarter: null }, { quarter: "" }] });
  }
  if (ownerId) where.ownerId = ownerId;

  const callerId = getUserId(session);
  const orgWide = isOrgWideAlignment(session);
  // departmentId + roleId feed audience resolution for the three-door
  // filter AND My goals, fetched once when either needs it.
  const me = !orgWide || mineOnly
    ? await prisma.user.findUnique({
        where: { id: callerId },
        select: { departmentId: true, roleId: true },
      })
    : null;
  // The caller's own person-tags: goals targeting any of them are visible.
  const myTagIds = !orgWide || mineOnly ? await getUserTagIds(orgId, callerId) : [];
  const treeIds = await getTeamUserIds(orgId, callerId);
  const hasTree = isManager(session) || treeIds.length > 1;

  // Three-door visibility. OKRs attach to PEOPLE, so an individual goal
  // is not org-public: everyone sees COMPANY objectives and their own
  // department's objectives; a person always sees their own (owned or a
  // resolved member through the goal's audience, resolved at read time, so
  // new hires inherit and leavers drop out); a manager additionally sees
  // their report tree's (owned or audience-covered, plus unowned
  // objectives, which managers create); admin, exec and HR see the org.
  if (!orgWide) {
    const visible: Prisma.OKRWhereInput[] = [
      { level: "COMPANY" },
      { ownerId: callerId },
    ];
    if (me?.departmentId) visible.push({ level: "DEPARTMENT", departmentId: me.departmentId });
    visible.push(...memberVisibilityOr({ id: callerId, departmentId: me?.departmentId, roleId: me?.roleId, tagIds: myTagIds }));
    if (hasTree) {
      visible.push({ ownerId: { in: treeIds } });
      visible.push({ ownerId: null });
      visible.push(...(await teamAudienceVisibilityOr(treeIds)));
    }
    and.push({ OR: visible });
  }
  if (mineOnly) {
    // My goals also carries the viewer's own department's DEPARTMENT goals:
    // until the department-goal GoalAssignee backfill has run in an org,
    // those goals have no audience row, and dropping them here would lose
    // them from the one view that should carry them.
    and.push({
      OR: [
        { ownerId: callerId },
        ...(me?.departmentId ? [{ level: "DEPARTMENT" as const, departmentId: me.departmentId }] : []),
        ...memberVisibilityOr({ id: callerId, departmentId: me?.departmentId, roleId: me?.roleId, tagIds: myTagIds }),
      ],
    });
  }
  if (teamOnly && orgWide) {
    // Team goals for an org-wide level is the org (spec-goals section 1:
    // "People team and Admin over the org"). No narrowing beyond visibility.
  } else if (teamOnly && hasTree) {
    // The report tree, never the viewer's own goals (those are My goals).
    // Unowned goals stay in the manager's view: managers create them and
    // must be able to find them.
    const reports = treeIds.filter((id) => id !== callerId);
    and.push({ OR: [{ ownerId: { in: reports } }, { ownerId: null }, ...(await teamAudienceVisibilityOr(reports))] });
  } else if (teamOnly) {
    // Team goals for someone nobody reports to is empty, never their own
    // visible goals under a Team title (the page shows My goals instead).
    and.push({ id: { in: [] } });
  }
  if (and.length > 0) where.AND = and;

  // Every visible goal, uncapped: the verdict filter and sort need them
  // all, and the page is sliced after (the retired take: 100 silently
  // dropped goals in larger orgs).
  const all = await prisma.oKR.findMany({
    where,
    select: {
      id: true, title: true, level: true, ownerId: true, status: true, progress: true, startDate: true, endDate: true,
      createdAt: true, completedAt: true, checkInCadence: true,
      keyResults: { select: { id: true, kpiId: true } },
    },
    orderBy: [{ level: "asc" }, { createdAt: "desc" }],
  });

  const [rollupCtx, linked, lastCheckIns, fiscal] = await Promise.all([
    computeGoalRollups(orgId),
    goalsWithLinkedWork(orgId, all.map((o) => o.id)),
    all.length
      ? prisma.kRCheckIn.groupBy({
          by: ["keyResultId"],
          where: { keyResultId: { in: all.flatMap((o) => o.keyResults.map((k) => k.id)) } },
          _max: { createdAt: true },
        })
      : Promise.resolve([] as Array<{ keyResultId: string; _max: { createdAt: Date | null } }>),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ]);
  const lastByKr = new Map(lastCheckIns.map((r) => [r.keyResultId, r._max.createdAt]));
  const now = new Date();
  const fiscalStart = (fiscal?.settings as { fiscalYearStart?: unknown } | null)?.fiscalYearStart;

  const ownerIdsAll = Array.from(new Set(all.map((o) => o.ownerId).filter((v): v is string => Boolean(v))));
  const ownersAll = ownerIdsAll.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: ownerIdsAll } },
        select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
      })
    : [];
  const ownerById = new Map(ownersAll.map((u) => [u.id, u]));
  const nameOf = (id: string | null) => {
    const u = id ? ownerById.get(id) : null;
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email : "";
  };

  const assessed = all.map((o) => {
    const rollup = goalRollupFor(rollupCtx, o);
    const { verdict, signals } = verdictForGoal({
      goal: o,
      rollup: { progress: rollup.progress, source: rollup.source },
      targets: o.keyResults.map((k) => ({ lastCheckInAt: lastByKr.get(k.id) ?? null, derived: k.kpiId != null })),
      hasLinkedWork: linked.has(o.id),
    }, now);
    let last: Date | null = null;
    for (const k of o.keyResults) {
      const d = lastByKr.get(k.id) ?? null;
      if (d && (!last || d > last)) last = d;
    }
    return {
      ...o,
      progress: rollup.progress,
      rollupStatus: rollup.status,
      progressSource: rollup.source,
      verdict,
      isStale: signals.isStale,
      lastCheckInAt: last,
      ownerName: nameOf(o.ownerId),
    };
  });

  // Direct reports (Filter > Direct reports only): solid reports plus dotted.
  let directIds: Set<string> | null = null;
  if (teamOnly && q.direct) {
    const [solid, dotted] = await Promise.all([
      prisma.user.findMany({ where: { organizationId: orgId, managerId: callerId, deletedAt: null }, select: { id: true } }),
      prisma.userDottedLine.findMany({ where: { managerId: callerId }, select: { userId: true } }),
    ]);
    directIds = new Set([...solid.map((u) => u.id), ...dotted.map((d) => d.userId)]);
  }

  const filtered = filterGoals(assessed, q, { quarterStart: fiscalQuarterStart(now, fiscalStart), directIds });

  // Team goals group headers, computed over every filtered row (not the
  // page), so a header's numbers are the person's real totals.
  const effortAll = teamOnly || withEffort
    ? await computeGoalEffortBatch(orgId, filtered.map((r) => r.id), now, await viewerFromSession())
    : new Map<string, GoalEffort>();
  const groupVerdict = new Map<string, GoalVerdict | null>();
  const groups: Array<{
    key: string; ownerId: string | null; name: string; avatar: string | null;
    goals: number; avgProgress: number | null; hoursThisMonth: number; lastMovedAt: Date | null; verdict: GoalVerdict | null;
  }> = [];
  if (teamOnly) {
    const byOwner = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const k = r.ownerId ?? "__unowned";
      byOwner.set(k, [...(byOwner.get(k) ?? []), r]);
    }
    for (const [k, rows] of byOwner) {
      const measured = rows.filter((r) => r.progressSource !== "NONE");
      const v = rollupVerdict(rows.map((r) => r.verdict));
      if (k !== "__unowned") groupVerdict.set(k, v);
      let lastMoved: Date | null = null;
      let hours = 0;
      for (const r of rows) {
        const e = effortAll.get(r.id);
        hours += e?.hoursThisMonth ?? 0;
        for (const d of [e?.lastActivityAt ?? null, r.lastCheckInAt]) if (d && (!lastMoved || d > lastMoved)) lastMoved = d;
      }
      const owner = k === "__unowned" ? null : ownerById.get(k) ?? null;
      groups.push({
        key: k,
        ownerId: k === "__unowned" ? null : k,
        name: k === "__unowned" ? "Unassigned" : nameOf(k),
        avatar: owner?.avatar ?? null,
        goals: rows.length,
        avgProgress: measured.length ? Math.round(measured.reduce((s, r) => s + r.progress, 0) / measured.length) : null,
        hoursThisMonth: Math.round(hours * 10) / 10,
        lastMovedAt: lastMoved,
        verdict: v,
      });
    }
  }
  const ordered = orderGoals(filtered, q.view === "all" ? "mine" : q.view, q.sort, groupVerdict);
  const paged = q.page != null ? paginate(ordered, q.page, q.pageSize) : { rows: ordered, page: 1, total: ordered.length };
  const pageIds = paged.rows.map((r) => r.id);

  // The heavier enrichment runs for the rows on this page only.
  const okrs = pageIds.length
    ? await prisma.oKR.findMany({
        where: { id: { in: pageIds } },
        include: {
          keyResults: {
            include: {
              _count: { select: { checkIns: true } },
              kpi: { select: KR_KPI_SELECT },
            },
            orderBy: { createdAt: "asc" },
          },
          children: { select: { id: true, title: true, progress: true, level: true, ownerId: true } },
        },
      })
    : [];
  const byId = new Map(okrs.map((o) => [o.id, o]));
  const pageOkrs = pageIds.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
  const assessedById = new Map(paged.rows.map((r) => [r.id, r]));

  const [groupsKr, audiences] = await Promise.all([
    enrichKeyResultGroups(pageOkrs.map((okr) => ({ userId: okr.ownerId, keyResults: okr.keyResults }))),
    summarizeGoalAudiences(orgId, pageOkrs.map((o) => ({ id: o.id, ownerId: o.ownerId }))),
  ]);

  // Per-goal Delete gate, resolved ONCE for the whole list (not N tree
  // walks): the exact rule DELETE /api/okrs/[id] enforces (canDeleteGoal),
  // so the row's Delete only appears when the API will honor it.
  const deleteOrgAdmin = isOrgAdminLevel(session);
  const deleteTeamIds = !deleteOrgAdmin && isManager(session) ? new Set(treeIds) : null;
  const canDeleteOkr = (oid: string | null): boolean => {
    if (deleteOrgAdmin) return true;
    if (oid === callerId) return true;
    if (deleteTeamIds === null) return false;
    if (!oid) return true;
    return deleteTeamIds.has(oid);
  };
  // Per-goal Edit gate: the exact rule PATCH /api/okrs enforces.
  const orgWideEdit = isOrgWideAlignment(session);
  const canEditOkr = (oid: string | null): boolean => {
    if (orgWideEdit) return true;
    if (oid === callerId) return true;
    if (deleteTeamIds === null) return false;
    if (!oid) return true;
    return deleteTeamIds.has(oid);
  };

  const enriched = pageOkrs.map((okr, i) => {
    const a = assessedById.get(okr.id)!;
    const e = effortAll.get(okr.id);
    return {
      ...okr,
      keyResults: groupsKr[i],
      owner: okr.ownerId ? ownerById.get(okr.ownerId) ?? null : null,
      canDelete: canDeleteOkr(okr.ownerId),
      canEdit: canEditOkr(okr.ownerId),
      ...(withEffort || teamOnly ? { effort: e ? { totalHours: e.totalHours, tasksOpen: e.tasksOpen, lastActivityAt: e.lastActivityAt } : { totalHours: 0, tasksOpen: 0, lastActivityAt: null } } : {}),
      progress: a.progress,
      status: a.rollupStatus,
      verdict: a.verdict,
      isStale: a.isStale,
      lastCheckInAt: a.lastCheckInAt,
      lastMovedAt: [e?.lastActivityAt ?? null, a.lastCheckInAt].reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null),
      quarterLabel: goalQuarterLabel(okr.endDate, fiscalStart),
      // "NONE" = nothing measurable and nothing hand-set: clients show
      // "Not measured" instead of a fake 0%.
      progressSource: a.progressSource,
      children: okr.children.map((c) => {
        const childRoll = goalRollupFor(rollupCtx, { ...c, status: "" });
        return { ...c, progress: childRoll.progress, progressSource: childRoll.source };
      }),
      audience: audiences.get(okr.id) ?? { members: [], totalMembers: 0, assigneeCount: 0 },
    };
  });

  // The legacy shape (a bare array) for callers that do not page.
  if (q.page == null) return jsonSuccess(enriched);

  // Team goals: the people in the chain with no goals at all, named once
  // under the table (a group needs a row, so they are not groups).
  let noGoals: Array<{ id: string; firstName: string | null; lastName: string | null; avatar: string | null; email: string }> = [];
  if (teamOnly && !orgWide && q.verdicts.length === 0 && !q.nudge && !q.q && q.owners.length === 0) {
    const withGoals = new Set(all.map((o) => o.ownerId).filter(Boolean) as string[]);
    const pool = (directIds ? [...directIds] : treeIds.filter((id) => id !== callerId)).filter((id) => !withGoals.has(id));
    noGoals = pool.length
      ? await prisma.user.findMany({ where: { id: { in: pool }, organizationId: orgId, deletedAt: null, status: { not: "INACTIVE" } }, select: { id: true, firstName: true, lastName: true, avatar: true, email: true }, orderBy: { firstName: "asc" } })
      : [];
  }

  return jsonSuccess({
    data: enriched,
    pagination: { page: paged.page, pageSize: q.pageSize, total: paged.total },
    // Group sizes across every filtered row, so a level header's count is
    // the real one, not the rows on this page.
    counts: {
      COMPANY: filtered.filter((r) => r.level === "COMPANY").length,
      DEPARTMENT: filtered.filter((r) => r.level === "DEPARTMENT").length,
      INDIVIDUAL: filtered.filter((r) => r.level === "INDIVIDUAL").length,
    },
    ...(teamOnly ? { groups, noGoals } : {}),
    canTeam: orgWide || hasTree,
    // The owner and level fields: the tier POST and PATCH accept them from.
    mayAssignOwners: isManager(session),
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Employees can create INDIVIDUAL OKRs for themselves; managers can create any
  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, description, level, quarter, startDate, endDate, ownerId, departmentId, parentId, keyResults, checkInCadence, assignees } = body;

  if (!isManager(session) && level !== "INDIVIDUAL") {
    return jsonError("Only managers can create Company/Team OKRs", 403);
  }

  if (!title?.trim()) return jsonError("Title required");

  // Audience, contributors beside the single accountable owner. Validate
  // BEFORE creating anything: shape, one-subject-per-row, de-dupe, and
  // every id must live inside the caller's organization.
  let audience: GoalAudienceRef[] = [];
  if (assignees !== undefined) {
    const parsed = await validateGoalAssignees(orgId, assignees);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    audience = parsed.entries;
  }

  // Door 1: an employee's objective is their OWN, they can't file goals
  // under someone else's name. Managers may assign anyone in the org.
  // A cross-org or unknown ownerId is a bad request body → 400.
  const effectiveOwnerId = isManager(session) ? (ownerId || null) : getUserId(session);
  if (effectiveOwnerId) {
    const owner = await prisma.user.findFirst({
      where: { id: effectiveOwnerId, organizationId: orgId },
      select: { id: true },
    });
    if (!owner) return jsonError("Owner is not a member of this organization", 400);
  }

  // departmentId is a real FK since the goals rebuild, a cross-org or
  // unknown id must 400 here, not 500 at the constraint.
  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: orgId },
      select: { id: true },
    });
    if (!dept) return jsonError("Department not found in this organization", 400);
  }

  // parentId is a real FK too, nesting under another org's goal (or a
  // typo'd id) must 400 here, not 500 at the constraint.
  if (parentId) {
    const parent = await prisma.oKR.findFirst({
      where: { id: parentId, organizationId: orgId },
      select: { id: true },
    });
    if (!parent) return jsonError("Parent goal not found in this organization", 400);
  }

  // NONE is a first-class opt-out: it silences the check-in reminder cron
  // (src/app/api/cron/okr-reminders) for this goal. checkInCadence is a
  // String column, so no migration is needed to carry the sentinel.
  const cadence =
    checkInCadence && ["WEEKLY", "BIWEEKLY", "MONTHLY", "NONE"].includes(checkInCadence)
      ? checkInCadence
      : "WEEKLY";

  // `kpiId` on a key result links it UP at a role KPI. Validate the whole
  // batch against the caller's org BEFORE creating anything, so a bad id
  // never leaves an orphan objective behind.
  const requestedKpiIds = Array.isArray(keyResults)
    ? Array.from(
        new Set(
          keyResults
            .map((kr) => kr?.kpiId)
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      )
    : [];
  const validKpiIds = new Set(
    requestedKpiIds.length > 0
      ? (
          await prisma.kPI.findMany({
            where: { id: { in: requestedKpiIds }, organizationId: orgId },
            select: { id: true },
          })
        ).map((k) => k.id)
      : [],
  );
  if (requestedKpiIds.some((id) => !validKpiIds.has(id))) {
    return jsonError("One or more kpiId values are not KPIs of this organization", 400);
  }

  const okr = await prisma.oKR.create({
    data: {
      title: title.trim(),
      description: description || null,
      level: normalizeGoalLevel(level) ?? "INDIVIDUAL",
      quarter: quarter || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      ownerId: effectiveOwnerId,
      departmentId: departmentId || null,
      parentId: parentId || null,
      checkInCadence: cadence,
      organizationId: orgId,
    },
  });

  // Audience rows, refs to users/departments/roles, resolved to people
  // at read time (one shared goal, one scoreboard; no per-person copies).
  if (audience.length > 0) {
    await addGoalAssignees(okr.id, audience);
  }

  // Create key results if provided.
  if (Array.isArray(keyResults) && keyResults.length > 0) {
    await prisma.keyResult.createMany({
      data: keyResults.map((kr) => ({
        title: kr.title,
        unit: kr.unit || null,
        startValue: kr.startValue || 0,
        targetValue: kr.targetValue || 100,
        kpiId: typeof kr.kpiId === "string" && validKpiIds.has(kr.kpiId) ? kr.kpiId : null,
        okrId: okr.id,
      })),
    });
  }

  // Roll the new goal up (and its parent chain, when nested) so the
  // stored summary is honest from the first read.
  const rollup = await persistGoalRollupChain(okr.id);

  const created = await prisma.oKR.findUnique({
    where: { id: okr.id },
    include: { keyResults: { include: { kpi: { select: KR_KPI_SELECT } } } },
  });
  const createdPayload = created
    ? {
        ...created,
        keyResults: await enrichKeyResults(created.keyResults, { userId: created.ownerId }),
        progressSource: rollup?.source ?? "NONE",
        audience: (await summarizeGoalAudiences(orgId, [{ id: created.id, ownerId: created.ownerId }])).get(created.id),
      }
    : created;

  logActivity({
    type: "okr_created",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Created OKR "${okr.title}" (${body.level || "INDIVIDUAL"})`,
    targetId: okr.id,
    targetType: "okr",
  });

  // Notify owner if assigned to someone else
  if (okr.ownerId && okr.ownerId !== getUserId(session)) {
    await prisma.notification.create({
      data: {
        userId: okr.ownerId,
        type: "okr_assigned",
        title: "You were given a goal",
        message: okr.title,
        link: `/okrs/${okr.id}`,
      },
    }).catch((err) => console.error("[OKR] Notification failed:", err));

    // Email the owner
    try {
      const [owner, actor] = await Promise.all([
        prisma.user.findUnique({ where: { id: okr.ownerId }, select: { email: true, firstName: true } }),
        prisma.user.findUnique({ where: { id: getUserId(session) }, select: { firstName: true, lastName: true } }),
      ]);
      if (owner?.email) {
        const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
        const { subject, html } = genericNotificationTemplate({
          heading: "OKR Assigned",
          recipientName: owner.firstName,
          subjectText: `${actor?.firstName || "Someone"} ${actor?.lastName || ""} assigned you a new OKR.`,
          itemTitle: okr.title,
          itemDetails: `${body.level || "INDIVIDUAL"} · ${body.quarter || "This quarter"}`,
          actionLabel: "View OKR",
          actionLink: `${baseUrl}/okrs/${okr.id}`,
          note: okr.description || undefined,
        });
        sendEmail({
          to: owner.email, subject, html,
          template: "okr-assigned",
          variables: { title: okr.title, quarter: body.quarter },
          organizationId: orgId, userId: okr.ownerId, category: "reminder",
        }).catch((err) => console.error("[OKR] Email failed:", err));
      }
    } catch (err) { console.error("[OKR] Email setup failed:", err); }
  }

  return jsonSuccess(createdPayload, 201);
}

// Columns a PATCH may touch, an unvalidated spread must never reach
// prisma (organizationId / id / createdAt are not editable, ever).
const OKR_PATCH_KEYS = [
  "title", "description", "level", "status", "progress", "quarter",
  "startDate", "endDate", "ownerId", "departmentId", "parentId",
  "checkInCadence", "position",
] as const;

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { id, ...rawUpdates } = body;

  if (!id) return jsonError("OKR ID required");

  const existing = await prisma.oKR.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("OKR not found", 404);

  // Edit gate: the owner, a manager with the owner in their report tree
  // (unowned objectives stay manager-editable), or an org-wide level.
  const callerId = getUserId(session);
  let canEdit = isOrgWideAlignment(session) || existing.ownerId === callerId;
  if (!canEdit && isManager(session)) {
    canEdit = existing.ownerId
      ? (await getTeamUserIds(orgId, callerId)).includes(existing.ownerId)
      : true;
  }
  if (!canEdit) {
    return jsonError("You can only edit your own goals or your reports' goals.", 403);
  }

  const updates: Record<string, unknown> = {};
  for (const key of OKR_PATCH_KEYS) {
    if (key in rawUpdates) updates[key] = rawUpdates[key];
  }
  // Employees can't re-home a goal onto someone else or escalate its level.
  if (!isManager(session)) {
    delete updates.ownerId;
    delete updates.level;
  }
  // level is an enum now, drop anything that doesn't normalize.
  if ("level" in updates) {
    const lvl = normalizeGoalLevel(updates.level);
    if (lvl) updates.level = lvl;
    else delete updates.level;
  }
  // checkInCadence is a free String column, only let known values through
  // (NONE opts the goal out of the check-in reminder cron). A garbage value
  // must never reach the column or the cron's cadence lookup.
  if ("checkInCadence" in updates &&
      !["WEEKLY", "BIWEEKLY", "MONTHLY", "NONE"].includes(updates.checkInCadence as string)) {
    delete updates.checkInCadence;
  }
  if (typeof updates.ownerId === "string" && updates.ownerId !== existing.ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: updates.ownerId, organizationId: orgId },
      select: { id: true },
    });
    if (!owner) return jsonError("Owner is not a member of this organization", 400);
  }
  // departmentId is a real FK, validate before Prisma hits the constraint.
  if (typeof updates.departmentId === "string" && updates.departmentId.length > 0) {
    const dept = await prisma.department.findFirst({
      where: { id: updates.departmentId, organizationId: orgId },
      select: { id: true },
    });
    if (!dept) return jsonError("Department not found in this organization", 400);
  }
  // parentId is a real FK, same rule, and a goal can never parent itself.
  if (typeof updates.parentId === "string" && updates.parentId.length > 0) {
    if (updates.parentId === id) return jsonError("A goal can't be its own parent", 400);
    const parent = await prisma.oKR.findFirst({
      where: { id: updates.parentId, organizationId: orgId },
      select: { id: true },
    });
    if (!parent) return jsonError("Parent goal not found in this organization", 400);
    // Part of can never point below the goal itself: walk up from the new
    // parent, and refuse when the walk reaches this goal (a cycle would
    // make both goals roll up into each other).
    const seen = new Set<string>();
    let cursor: string | null = updates.parentId;
    while (cursor && !seen.has(cursor)) {
      if (cursor === id) return jsonError("That goal is part of this one, so it can't also contain it.", 400);
      seen.add(cursor);
      const up: { parentId: string | null } | null = await prisma.oKR.findFirst({ where: { id: cursor, organizationId: orgId }, select: { parentId: true } });
      cursor = up?.parentId ?? null;
    }
  }
  if (updates.parentId === "") updates.parentId = null;

  // Mark complete (spec-goals /okrs row menu): status is re-derived from the
  // targets on every read, so the person's decision lives in completedAt,
  // which nothing re-derives. `completed: false` (or a status other than
  // COMPLETED) reopens it.
  const completedFlag = typeof rawUpdates.completed === "boolean"
    ? rawUpdates.completed
    : "status" in updates
      ? updates.status === "COMPLETED"
      : undefined;
  if (completedFlag === true && !existing.completedAt) updates.completedAt = new Date();
  if (completedFlag === false && existing.completedAt) updates.completedAt = null;
  if (completedFlag === true) updates.status = "COMPLETED";
  // Reopening: the stored status goes back to what the progress says (the
  // rollup below re-derives it again for a measured goal).
  if (completedFlag === false && existing.status === "COMPLETED" && !("status" in updates)) {
    updates.status = okrStatusFor(Math.min(99, existing.progress));
  }

  // Audience full-replacement: `assignees: [{type, id}]` becomes the
  // goal's exact audience (validated, de-duped, org-checked; diff-synced
  // so untouched rows keep their createdAt).
  let audience: GoalAudienceRef[] | null = null;
  if (rawUpdates.assignees !== undefined) {
    const parsed = await validateGoalAssignees(orgId, rawUpdates.assignees);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    audience = parsed.entries;
  }

  if (updates.startDate) updates.startDate = new Date(updates.startDate as string);
  if (updates.endDate) updates.endDate = new Date(updates.endDate as string);

  const updated = await prisma.oKR.update({
    where: { id },
    data: updates as Prisma.OKRUpdateInput,
    include: { keyResults: { include: { kpi: { select: KR_KPI_SELECT } } } },
  });
  if (audience !== null) {
    await syncGoalAssignees(id, audience);
  }

  // Re-derive stored progress/status for this goal and its ancestors,
  // a PATCH can move the goal (parentId), hand-set progress, or change
  // the owner whose KPI readings drive linked KRs. If the goal LEFT a
  // parent, that old chain shrinks too and must be recomputed.
  const rollup = await persistGoalRollupChain(id);
  if (existing.parentId && existing.parentId !== updated.parentId) {
    await persistGoalRollupChain(existing.parentId);
  }

  return jsonSuccess({
    ...updated,
    keyResults: await enrichKeyResults(updated.keyResults, { userId: updated.ownerId }),
    progress: rollup?.progress ?? updated.progress,
    status: rollup?.status ?? updated.status,
    progressSource: rollup?.source ?? "NONE",
    audience: (await summarizeGoalAudiences(orgId, [{ id: updated.id, ownerId: updated.ownerId }])).get(updated.id),
  });
}
