// GET /api/okrs/[id]/effort — the AUTOMATED effort signal for a goal.
//
// Honest, never self-reported: it derives "how much real work is moving this
// goal" from the Tasks under the goal's linked KRAs (OKR → KRA via EntityLink).
// Sums logged hours, counts done vs open, finds who's contributing and when it
// last moved. If nothing's linked, it says so (nudge to link a board/KRA).
//
// Visibility mirrors the goal itself (canSeeGoal); no extra data leaks.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: orgId } });
  if (!okr) return jsonError("Not found", 404);
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  // The goal's linked KRAs — the join point between a goal and real work.
  const links = await prisma.entityLink.findMany({
    where: { organizationId: orgId, sourceType: "OKR", sourceId: id, targetType: "KRA" },
    select: { targetId: true },
  });
  const kraIds = [...new Set(links.map((l) => l.targetId))];
  if (kraIds.length === 0) {
    return jsonSuccess({ hasLinkedWork: false, linkedKras: 0, totalHours: 0, tasksDone: 0, tasksOpen: 0, lastActivityAt: null, contributors: [] });
  }

  const tasks = await prisma.task.findMany({
    where: { organizationId: orgId, kraId: { in: kraIds } },
    select: {
      hoursSpent: true, status: true, completedAt: true, updatedAt: true,
      assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  let totalHours = 0, tasksDone = 0, tasksOpen = 0;
  let lastActivityAt: Date | null = null;
  const byUser = new Map<string, { id: string; name: string; hours: number; tasks: number }>();
  for (const t of tasks) {
    const h = t.hoursSpent ?? 0;
    totalHours += h;
    if (t.status === "COMPLETED") tasksDone += 1; else tasksOpen += 1;
    const act = t.completedAt ?? t.updatedAt;
    if (act && (!lastActivityAt || act > lastActivityAt)) lastActivityAt = act;
    const u = t.assignee;
    if (u) {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
      const cur = byUser.get(u.id) ?? { id: u.id, name, hours: 0, tasks: 0 };
      cur.hours += h; cur.tasks += 1;
      byUser.set(u.id, cur);
    }
  }
  const contributors = [...byUser.values()]
    .map((c) => ({ ...c, hours: Math.round(c.hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours || b.tasks - a.tasks);

  return jsonSuccess({
    hasLinkedWork: true,
    linkedKras: kraIds.length,
    totalHours: Math.round(totalHours * 10) / 10,
    tasksDone,
    tasksOpen,
    lastActivityAt,
    contributors,
  });
}
