// /api/talent-assessment: the talent grid (spec-teams-performance /talent).
//
// GET  ?period=  the placements in the viewer's scope for a period (every
//      period when omitted), with the person, their department, job title
//      and manager, and who placed them. Never the viewer's own placement.
//      A GET never writes (PO-22): the old ?auto=true seeded rows from a read.
// POST { userId, period, performance, potential, action?, notes? }: place or
//      move one person (a MANUAL placement). { autoPlace: true, period } is
//      kept for one release and runs Fill from scores (POST /fill).
//
// Scope (lib/performance/talent.server.ts): the People team and Admin see
// the org, anyone with reports their chain, nobody else anything.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { fillFromScores, talentCtx } from "@/lib/performance/talent.server";
import { TALENT_ACTIONS, actionLabel, boxLabel, levelLabel } from "@/lib/performance/talent";
import { toCsv } from "@/lib/csv";

const ACTIONS = new Set(TALENT_ACTIONS.map((a) => a.value));

export async function GET(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);

  const period = new URL(req.url).searchParams.get("period") || "";
  const assessments = await prisma.talentAssessment.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(period ? { period } : {}),
      userId: ctx.ids === null ? { not: ctx.userId } : { in: ctx.ids.filter((id) => id !== ctx.userId) },
    },
    orderBy: { updatedAt: "desc" },
  });

  const userIds = [...new Set([...assessments.map((a) => a.userId), ...assessments.map((a) => a.assessedBy)])];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, organizationId: ctx.organizationId },
        select: {
          id: true, firstName: true, lastName: true, avatar: true, managerId: true, deletedAt: true,
          department: { select: { id: true, name: true } },
          role: { select: { id: true, title: true } },
        },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u] as const));

  const rows = assessments
    // A person who has left is not on the grid.
    .filter((a) => byId.get(a.userId) && !byId.get(a.userId)!.deletedAt)
    .map((a) => {
      const by = byId.get(a.assessedBy);
      return {
        ...a,
        user: byId.get(a.userId) ?? null,
        placedBy: by ? { id: by.id, name: `${by.firstName} ${by.lastName}`.trim() } : null,
      };
    });

  // Export CSV (and Export selected with ?ids=): never for an Agent.
  const sp = new URL(req.url).searchParams;
  if (sp.get("format") === "csv") {
    if (ctx.isAgent) return jsonError("Forbidden", 403);
    const only = new Set((sp.get("ids") ?? "").split(",").filter(Boolean));
    const csv = toCsv(
      rows.filter((r) => !only.size || only.has(r.id)).map((r) => ({
        Person: r.user ? `${r.user.firstName} ${r.user.lastName}`.trim() : "",
        Department: r.user?.department?.name ?? "",
        "Job title": r.user?.role?.title ?? "",
        Box: boxLabel(r.boxPosition),
        Performance: levelLabel(r.performance),
        Potential: levelLabel(r.potential),
        Action: actionLabel(r.action),
        Period: r.period,
        "Placed by": r.placedBy?.name ?? "",
        "Placed on": r.updatedAt.toISOString().slice(0, 10),
      })),
      ["Person", "Department", "Job title", "Box", "Performance", "Potential", "Action", "Period", "Placed by", "Placed on"],
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="talent-${(period || "all").replace(/[^\w-]+/g, "-")}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return jsonSuccess(rows);
}

export async function POST(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const period = typeof body.period === "string" ? body.period.trim().slice(0, 100) : "";

  if (body.autoPlace === true) {
    if (!period) return jsonError("period required");
    const res = await fillFromScores(ctx, period);
    if (res.placed > 0) {
      logActivity({
        type: "talent_assessment_auto_placed",
        actorId: ctx.userId,
        organizationId: ctx.organizationId,
        description: `Placed ${res.placed} people from performance scores for ${period}`,
        targetType: "talent_assessment",
        metadata: { period, ...res },
      });
    }
    return jsonSuccess({ ...res, period });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const performance = Number(body.performance);
  const potential = Number(body.potential);
  if (!userId || !period || !body.performance || !body.potential) {
    return jsonError("userId, period, performance, and potential required");
  }
  if (![1, 2, 3].includes(performance) || ![1, 2, 3].includes(potential)) {
    return jsonError("performance and potential must each be 1, 2 or 3");
  }
  const action = typeof body.action === "string" && body.action ? body.action : null;
  if (action && !ACTIONS.has(action)) return jsonError("Unknown action", 400);
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 5000) : null;
  // Only people the caller may place: in their scope, in this org, and never
  // themself.
  if (userId === ctx.userId) return jsonError("You can't place yourself on the grid", 403);
  if (ctx.ids !== null && !ctx.ids.includes(userId)) return jsonError("Not found", 404);
  const target = await prisma.user.findFirst({ where: { id: userId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
  if (!target) return jsonError("Not found", 404);

  const boxPosition = `${performance}-${potential}`;
  const assessment = await prisma.talentAssessment.upsert({
    where: { userId_period_organizationId: { userId, period, organizationId: ctx.organizationId } },
    create: { userId, period, performance, potential, boxPosition, action, notes, assessedBy: ctx.userId, organizationId: ctx.organizationId, source: "MANUAL" },
    update: { performance, potential, boxPosition, action, notes, assessedBy: ctx.userId, source: "MANUAL" },
  });

  logActivity({
    type: "talent_assessment_upserted",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Placed person in ${boxPosition} for ${period}${action ? ` (action: ${action})` : ""}`,
    targetId: assessment.id,
    targetType: "talent_assessment",
    metadata: { userId, period, performance, potential, boxPosition, action },
  });

  return jsonSuccess(assessment);
}
