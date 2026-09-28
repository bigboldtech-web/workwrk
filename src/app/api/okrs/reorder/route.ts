import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { goalCreatorIds, goalRightsActor } from "@/lib/alignment-scope";
import { GOAL_EDIT_REFUSED, mayEditGoal } from "@/lib/goals/goal-rights";

/**
 * Batch-update OKR.position for a manual drag-reorder. Mirrors the
 * Idea reorder endpoint, see that file for the rationale.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const body = await req.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return jsonError("Provide a non-empty items array");
  }
  if (items.length > 500) return jsonError("Too many items in one reorder");
  for (const it of items) {
    if (typeof it?.id !== "string" || typeof it?.position !== "number") {
      return jsonError("Each item must be { id: string, position: number }");
    }
  }

  const ids = (items as Array<{ id: string }>).map((i) => i.id);
  const owned = await prisma.oKR.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true, level: true, ownerId: true },
  });
  if (owned.length !== items.length) {
    return jsonError("One or more OKRs are not in your organization", 403);
  }
  // Moving a goal is an edit of it: every goal in the batch needs the edit
  // right (mayEditGoal), or nothing moves.
  const [actor, creators] = await Promise.all([goalRightsActor(session), goalCreatorIds(orgId, ids)]);
  if (!owned.every((o) => mayEditGoal(actor, { level: o.level, ownerId: o.ownerId, creatorId: creators.get(o.id) ?? null }))) {
    return jsonError(GOAL_EDIT_REFUSED, 403);
  }

  await prisma.$transaction(
    items.map((it: { id: string; position: number }) =>
      prisma.oKR.update({
        where: { id: it.id },
        data: { position: it.position },
      })
    )
  );

  return jsonSuccess({ reordered: items.length });
}
