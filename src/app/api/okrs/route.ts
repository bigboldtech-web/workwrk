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
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import type { GoalLevel, Prisma } from "@/generated/prisma";

// OKR.level is the GoalLevel enum since the goals rebuild. Legacy
// clients may still send "TEAM" — map it to DEPARTMENT, mirroring the
// goal_audience_kra_weight migration; anything unrecognised is null.
function normalizeGoalLevel(v: unknown): GoalLevel | null {
  if (v === "TEAM") return "DEPARTMENT";
  return v === "COMPANY" || v === "DEPARTMENT" || v === "INDIVIDUAL" ? v : null;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const quarter = url.searchParams.get("quarter");
  const ownerId = url.searchParams.get("ownerId");
  // ?mine=1 — only goals the CALLER personally carries: owned by them, or
  // where they are a resolved audience member (their user row, their
  // department, their role). A filter WITHIN visibility, not a new door —
  // org-wide viewers get the same narrowing. Backs /okrs?mine=1.
  const mineOnly = url.searchParams.get("mine") === "1";

  const where: Prisma.OKRWhereInput = { organizationId: orgId };
  const and: Prisma.OKRWhereInput[] = [];
  const levelFilter = normalizeGoalLevel(level);
  if (levelFilter) where.level = levelFilter;
  if (quarter) {
    and.push({ OR: [{ quarter }, { quarter: null }, { quarter: "" }] });
  }
  if (ownerId) where.ownerId = ownerId;

  const callerId = getUserId(session);
  const orgWide = isOrgWideAlignment(session);
  // departmentId + roleId feed audience resolution for the three-door
  // filter AND ?mine=1 — fetched once when either needs it.
  const me = !orgWide || mineOnly
    ? await prisma.user.findUnique({
        where: { id: callerId },
        select: { departmentId: true, roleId: true },
      })
    : null;

  // Three-door visibility. OKRs attach to PEOPLE, so an individual goal
  // is not org-public: everyone sees COMPANY objectives and their own
  // department's TEAM objectives; a person always sees their own — owned
  // OR resolved-member via the goal's audience (their user row, their
  // department, their role — resolved at read time, so new hires inherit
  // and leavers drop out); a manager additionally sees their report
  // tree's (owned or audience-covered, plus unowned objectives, which
  // managers create); admin / exec / HR see the org.
  if (!orgWide) {
    const visible: Prisma.OKRWhereInput[] = [
      { level: "COMPANY" },
      { ownerId: callerId },
    ];
    if (me?.departmentId) visible.push({ level: "DEPARTMENT", departmentId: me.departmentId });
    visible.push(...memberVisibilityOr({ id: callerId, departmentId: me?.departmentId, roleId: me?.roleId }));
    if (isManager(session)) {
      const teamIds = await getTeamUserIds(orgId, callerId);
      visible.push({ ownerId: { in: teamIds } });
      visible.push({ ownerId: null });
      visible.push(...(await teamAudienceVisibilityOr(teamIds)));
    }
    and.push({ OR: visible });
  }
  if (mineOnly) {
    and.push({
      OR: [
        { ownerId: callerId },
        ...memberVisibilityOr({ id: callerId, departmentId: me?.departmentId, roleId: me?.roleId }),
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const okrs = await prisma.oKR.findMany({
    where,
    include: {
      keyResults: {
        include: {
          _count: { select: { checkIns: true } },
          // The role-level gauge this KR pushes, when linked.
          kpi: { select: KR_KPI_SELECT },
        },
        orderBy: { createdAt: "asc" },
      },
      children: { select: { id: true, title: true, progress: true, level: true, ownerId: true } },
    },
    orderBy: [{ level: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  // Derivation is read-side: a KR linked to a KPI reports the gauge's latest
  // reading, not the hand-typed number still sitting on its row. Objective
  // progress/status then roll up through the org-wide goal graph — a leaf
  // from its live KRs, a parent from its KRs + measured children — via
  // computeGoalRollups, the ONE rollup implementation, so this list shows
  // exactly the number the detail page / dashboard / profile hero show.
  // ownerId is a bare column (no Prisma relation), so resolve the single
  // accountable owner per goal in ONE batch query — the list card renders
  // the real person (avatar + name), never a bare id or "Unassigned".
  const ownerIds = Array.from(
    new Set(okrs.map((o) => o.ownerId).filter((v): v is string => Boolean(v))),
  );
  const [groups, audiences, rollupCtx, owners] = await Promise.all([
    enrichKeyResultGroups(
      okrs.map((okr) => ({ userId: okr.ownerId, keyResults: okr.keyResults })),
    ),
    // Resolved assignee summaries — avatars + overflow count, never raw
    // join rows. Resolution happens here, at read time.
    summarizeGoalAudiences(orgId, okrs.map((o) => ({ id: o.id, ownerId: o.ownerId }))),
    computeGoalRollups(orgId),
    ownerIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
        })
      : Promise.resolve([]),
  ]);
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  // Per-goal Delete gate, resolved ONCE for the whole list (not N tree
  // walks): org admins delete anything; a manager deletes their report
  // tree's goals plus unowned ones; everyone else only their own. This is
  // the exact rule DELETE /api/okrs/[id] enforces (canDeleteGoal), so the
  // row's "…"/right-click Delete only appears when the API will honor it.
  const deleteCallerId = getUserId(session);
  const deleteOrgAdmin = isOrgAdminLevel(session);
  const deleteTeamIds =
    !deleteOrgAdmin && isManager(session)
      ? new Set(await getTeamUserIds(orgId, deleteCallerId))
      : null;
  const canDeleteOkr = (ownerId: string | null): boolean => {
    if (deleteOrgAdmin) return true;
    if (ownerId === deleteCallerId) return true;
    if (deleteTeamIds === null) return false; // not a manager
    if (!ownerId) return true; // unowned objectives are manager-owned
    return deleteTeamIds.has(ownerId);
  };
  // Per-goal Edit gate — the exact rule PATCH /api/okrs enforces (owner /
  // tree-manager / org-wide alignment levels, canEditOkrOwner's ladder),
  // so the row's Edit affordance only appears when the API will honor it.
  // Edit is deliberately broader than Delete: DIRECTOR/VP/C_LEVEL/HR may
  // edit any goal but not wipe it. deleteTeamIds is reusable here — it is
  // null only for org admins (orgWideEdit covers them) or non-managers.
  const orgWideEdit = isOrgWideAlignment(session);
  const canEditOkr = (ownerId: string | null): boolean => {
    if (orgWideEdit) return true;
    if (ownerId === deleteCallerId) return true;
    if (deleteTeamIds === null) return false; // not a manager
    if (!ownerId) return true; // unowned objectives are manager-editable
    return deleteTeamIds.has(ownerId);
  };

  const enriched = okrs.map((okr, i) => {
    const keyResults = groups[i];
    const rollup = goalRollupFor(rollupCtx, okr);
    return {
      ...okr,
      keyResults,
      owner: okr.ownerId ? ownerById.get(okr.ownerId) ?? null : null,
      canDelete: canDeleteOkr(okr.ownerId),
      canEdit: canEditOkr(okr.ownerId),
      progress: rollup.progress,
      status: rollup.status,
      // "NONE" = nothing measurable and nothing hand-set — clients show
      // an honest "—" instead of a fake 0% that reads as "behind".
      progressSource: rollup.source,
      children: okr.children.map((c) => {
        const childRoll = goalRollupFor(rollupCtx, { ...c, status: "" });
        return { ...c, progress: childRoll.progress, progressSource: childRoll.source };
      }),
      audience: audiences.get(okr.id) ?? { members: [], totalMembers: 0, assigneeCount: 0 },
    };
  });

  return jsonSuccess(enriched);
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

  // Audience — contributors beside the single accountable owner. Validate
  // BEFORE creating anything: shape, one-subject-per-row, de-dupe, and
  // every id must live inside the caller's organization.
  let audience: GoalAudienceRef[] = [];
  if (assignees !== undefined) {
    const parsed = await validateGoalAssignees(orgId, assignees);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    audience = parsed.entries;
  }

  // Door 1: an employee's objective is their OWN — they can't file goals
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

  // departmentId is a real FK since the goals rebuild — a cross-org or
  // unknown id must 400 here, not 500 at the constraint.
  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: orgId },
      select: { id: true },
    });
    if (!dept) return jsonError("Department not found in this organization", 400);
  }

  // parentId is a real FK too — nesting under another org's goal (or a
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

  // Audience rows — refs to users/departments/roles, resolved to people
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
        title: "New OKR Assigned to You",
        message: okr.title,
        link: "/okrs",
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
          actionLink: `${baseUrl}/okrs`,
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

// Columns a PATCH may touch — an unvalidated spread must never reach
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
  // level is an enum now — drop anything that doesn't normalize.
  if ("level" in updates) {
    const lvl = normalizeGoalLevel(updates.level);
    if (lvl) updates.level = lvl;
    else delete updates.level;
  }
  // checkInCadence is a free String column — only let known values through
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
  // departmentId is a real FK — validate before Prisma hits the constraint.
  if (typeof updates.departmentId === "string" && updates.departmentId.length > 0) {
    const dept = await prisma.department.findFirst({
      where: { id: updates.departmentId, organizationId: orgId },
      select: { id: true },
    });
    if (!dept) return jsonError("Department not found in this organization", 400);
  }
  // parentId is a real FK — same rule, and a goal can never parent itself.
  if (typeof updates.parentId === "string" && updates.parentId.length > 0) {
    if (updates.parentId === id) return jsonError("A goal can't be its own parent", 400);
    const parent = await prisma.oKR.findFirst({
      where: { id: updates.parentId, organizationId: orgId },
      select: { id: true },
    });
    if (!parent) return jsonError("Parent goal not found in this organization", 400);
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

  // Re-derive stored progress/status for this goal and its ancestors —
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
