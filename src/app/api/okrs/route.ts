import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOrgWideAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import { enrichKeyResultGroups, enrichKeyResults, KR_KPI_SELECT, rollUpOkrProgress } from "@/lib/alignment";
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

  const where: Prisma.OKRWhereInput = { organizationId: orgId };
  const and: Prisma.OKRWhereInput[] = [];
  const levelFilter = normalizeGoalLevel(level);
  if (levelFilter) where.level = levelFilter;
  if (quarter) {
    and.push({ OR: [{ quarter }, { quarter: null }, { quarter: "" }] });
  }
  if (ownerId) where.ownerId = ownerId;

  // Three-door visibility. OKRs attach to PEOPLE, so an individual goal
  // is not org-public: everyone sees COMPANY objectives and their own
  // department's TEAM objectives; a person always sees their own; a
  // manager additionally sees their report tree's (plus unowned
  // objectives, which managers create); admin / exec / HR see the org.
  if (!isOrgWideAlignment(session)) {
    const callerId = getUserId(session);
    const visible: Prisma.OKRWhereInput[] = [
      { level: "COMPANY" },
      { ownerId: callerId },
    ];
    const me = await prisma.user.findUnique({
      where: { id: callerId },
      select: { departmentId: true },
    });
    if (me?.departmentId) visible.push({ level: "DEPARTMENT", departmentId: me.departmentId });
    if (isManager(session)) {
      const teamIds = await getTeamUserIds(orgId, callerId);
      visible.push({ ownerId: { in: teamIds } });
      visible.push({ ownerId: null });
    }
    and.push({ OR: visible });
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
  // progress then rolls up from those live KR numbers (an OKR with no key
  // results keeps whatever progress was set on it directly).
  const groups = await enrichKeyResultGroups(
    okrs.map((okr) => ({ userId: okr.ownerId, keyResults: okr.keyResults })),
  );
  const enriched = okrs.map((okr, i) => {
    const keyResults = groups[i];
    const rolled = rollUpOkrProgress(keyResults);
    return { ...okr, keyResults, progress: rolled ?? okr.progress };
  });

  return jsonSuccess(enriched);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Employees can create INDIVIDUAL OKRs for themselves; managers can create any
  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, description, level, quarter, startDate, endDate, ownerId, departmentId, parentId, keyResults, checkInCadence } = body;

  if (!isManager(session) && level !== "INDIVIDUAL") {
    return jsonError("Only managers can create Company/Team OKRs", 403);
  }

  if (!title?.trim()) return jsonError("Title required");

  // Door 1: an employee's objective is their OWN — they can't file goals
  // under someone else's name. Managers may assign anyone in the org.
  const effectiveOwnerId = isManager(session) ? (ownerId || null) : getUserId(session);
  if (effectiveOwnerId) {
    const owner = await prisma.user.findFirst({
      where: { id: effectiveOwnerId, organizationId: orgId },
      select: { id: true },
    });
    if (!owner) return jsonError("Owner not found in this organization", 404);
  }

  const cadence =
    checkInCadence && ["WEEKLY", "BIWEEKLY", "MONTHLY"].includes(checkInCadence)
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

  const created = await prisma.oKR.findUnique({
    where: { id: okr.id },
    include: { keyResults: { include: { kpi: { select: KR_KPI_SELECT } } } },
  });
  const createdPayload = created
    ? {
        ...created,
        keyResults: await enrichKeyResults(created.keyResults, { userId: created.ownerId }),
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
  if (typeof updates.ownerId === "string" && updates.ownerId !== existing.ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: updates.ownerId, organizationId: orgId },
      select: { id: true },
    });
    if (!owner) return jsonError("Owner not found in this organization", 404);
  }

  if (updates.startDate) updates.startDate = new Date(updates.startDate as string);
  if (updates.endDate) updates.endDate = new Date(updates.endDate as string);

  const updated = await prisma.oKR.update({
    where: { id },
    data: updates as Prisma.OKRUpdateInput,
    include: { keyResults: { include: { kpi: { select: KR_KPI_SELECT } } } },
  });

  return jsonSuccess({
    ...updated,
    keyResults: await enrichKeyResults(updated.keyResults, { userId: updated.ownerId }),
  });
}
