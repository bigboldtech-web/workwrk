// POST /api/okrs/[id]/refresh: count this goal's List and table sources now
// (docs/plans/recurring-goals.md C7, I).
//
//   {}                     the goal page on open: only the sources counted
//                          more than 10 minutes ago (the page renders the
//                          stored number first, then repaints if it moved)
//   { keyResultId }        Refresh in the target's row menu: that target,
//                          now, whatever its age or signature
//
// Anyone who may check in may ask (Can edit or a contributor, as the
// check-in route), after canSeeGoal (a goal they cannot see answers 404).
// The count runs as each source's connector, never as the caller (C8), so
// asking never widens what a number is counted from. Rate limited per goal:
// 6 a minute. Answers { counted, paused, changed }.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";
import { canEditGoal } from "@/lib/alignment-scope";
import { isGoalContributor } from "@/lib/goals/goal-contributor";
import { rateLimit } from "@/lib/rate-limit-memory";
import { refreshGoalSources } from "@/lib/goals/goal-source.server";

/** The goal page counts a source again once it is this old (C7). */
export const PAGE_REFRESH_AGE_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: orgId }, select: { id: true, level: true, ownerId: true, departmentId: true } });
  if (!okr || !(await canSeeGoal(session, okr))) return jsonError("Not found", 404);
  if (!(await canEditGoal(session, okr)) && !(await isGoalContributor(session, id))) {
    return jsonError("You need Can edit on this goal to refresh its numbers.", 403);
  }
  const body = (await req.json().catch(() => ({}))) as { keyResultId?: unknown };
  const keyResultId = typeof body?.keyResultId === "string" && body.keyResultId ? body.keyResultId : null;
  if (keyResultId && !(await prisma.keyResult.findFirst({ where: { id: keyResultId, okrId: id }, select: { id: true } }))) {
    return jsonError("Key Result not found", 404);
  }
  const limited = rateLimit(`goal-refresh:${id}`, { max: 6, windowMs: 60_000 });
  if (!limited.ok) return jsonError("This goal was just refreshed. Try again in a minute.", 429);

  const r = await refreshGoalSources(orgId, keyResultId
    ? { okrIds: [id], keyResultIds: [keyResultId], force: true }
    : { okrIds: [id], minAgeMs: PAGE_REFRESH_AGE_MS });
  return jsonSuccess({ counted: r.counted, paused: r.paused, changed: r.changed.includes(id) });
}
