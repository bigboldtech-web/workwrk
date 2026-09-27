// GET /api/okrs/[id]/effort: the AUTOMATED effort signal for a goal (the
// Effort card): hours, tasks done and open, who is driving it and when it
// last moved, from every piece of work linked to the goal (KRAs, Lists,
// Spaces; src/lib/goal-effort.ts). Contributors carry their avatar.
// Visibility mirrors the goal itself (canSeeGoal). Reads only.

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
