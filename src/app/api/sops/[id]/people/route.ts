import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { effectiveRunStatus } from "@/lib/process-runs";

/**
 * GET /api/sops/[id]/people (spec-process section 2 `/sops/[id]` People tab):
 * the SOP's assignments joined with their compliance row and, for
 * Checklists, the assignee's latest run, in one payload.
 *
 * Scope is the same rule GET /api/sop-assignments applies: a Member sees
 * only their own row; a manager their report tree; the org-wide roles
 * (admins, execs, HR) everyone. The summary line ("12 assigned · 9 done ·
 * 2 overdue") is counted over the scoped rows so the numbers and the rows
 * always agree.
 */
const ORG_WIDE = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);

  const sop = await prisma.sOP.findFirst({ where: { id, organizationId: orgId }, select: { id: true, sopType: true, content: true } });
  if (!sop) return jsonError("SOP not found", 404);

  const where: Record<string, unknown> = { sopId: id };
  const level = (session.user as { accessLevel?: string }).accessLevel ?? "";
  if (!isManager(session)) {
    where.userId = callerId;
  } else if (!ORG_WIDE.has(level)) {
    where.userId = { in: await getTeamUserIds(orgId, callerId) };
  }

  const [assignments, compliance] = await Promise.all([
    prisma.sOPAssignment.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true, department: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sOPCompliance.findMany({ where: { sopId: id }, select: { userId: true, score: true, stepsTotal: true, stepsCompleted: true, completedAt: true } }),
  ]);

  const userIds = assignments.map((a) => a.userId);
  const runs = sop.sopType === "CHECKLIST" && userIds.length > 0
    ? await prisma.processRun.findMany({
        where: { sopId: id, assigneeId: { in: userIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, assigneeId: true, progress: true, status: true, shareToken: true, dueDate: true, completedSteps: true },
      })
    : [];
  const latestRunByUser = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (r.assigneeId && !latestRunByUser.has(r.assigneeId)) latestRunByUser.set(r.assigneeId, r);
  const complianceByUser = new Map(compliance.map((c) => [c.userId, c]));

  const now = new Date();
  let done = 0;
  let overdue = 0;
  const sections = Array.isArray((sop.content as { sections?: unknown[] } | null)?.sections)
    ? ((sop.content as { sections: Array<{ steps?: unknown[] }> }).sections)
    : [];
  const sectionCount = sections.length;

  const rows = assignments.map((a) => {
    const isDone = a.status === "COMPLETED";
    const isOverdue = !isDone && !!a.dueDate && a.dueDate.getTime() < now.getTime();
    if (isDone) done += 1;
    if (isOverdue) overdue += 1;
    const c = complianceByUser.get(a.userId) ?? null;
    const run = latestRunByUser.get(a.userId) ?? null;
    return {
      id: a.id,
      user: a.user,
      department: a.user.department ?? null,
      assignedAt: a.createdAt,
      dueDate: a.dueDate,
      mandatory: a.mandatory,
      status: isDone ? "COMPLETED" : isOverdue ? "OVERDUE" : a.status,
      stepsTotal: a.stepsTotal,
      stepsCompleted: a.stepsCompleted,
      completedAt: a.completedAt,
      score: c?.score ?? a.score ?? null,
      run: run
        ? { id: run.id, progress: run.progress, status: effectiveRunStatus(run.status, run.dueDate, now), shareToken: run.shareToken, doneSteps: Array.isArray(run.completedSteps) ? (run.completedSteps as unknown[]).length : 0 }
        : null,
    };
  });

  const hasScores = rows.some((r) => r.score !== null);
  return jsonSuccess({
    data: rows,
    summary: { assigned: rows.length, done, overdue },
    sectionCount,
    hasScores,
  });
}
