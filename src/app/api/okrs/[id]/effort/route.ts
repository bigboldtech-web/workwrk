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
import { computeGoalEffort } from "@/lib/goal-effort";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: orgId } });
  if (!okr) return jsonError("Not found", 404);
  if (!(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  // KRA tasks + linked-board/space item time — the join point between a goal
  // and the real work moving it.
  return jsonSuccess(await computeGoalEffort(orgId, id));
}
