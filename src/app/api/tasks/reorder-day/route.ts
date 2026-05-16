import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Batch-update Task.dayPosition for a within-day drag-reorder in the
 * week view. Body: `{ items: [{ id, dayPosition }, ...] }`.
 *
 * We restrict the batch to the caller's own assigned tasks — there's
 * no use case yet for reordering somebody else's day. Managers who
 * want to reschedule other people's work do it via the usual edit
 * surface, not drag-reorder.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return jsonError("Provide a non-empty items array");
  }
  if (items.length > 500) return jsonError("Too many items in one reorder");
  for (const it of items) {
    if (typeof it?.id !== "string" || typeof it?.dayPosition !== "number") {
      return jsonError("Each item must be { id: string, dayPosition: number }");
    }
  }

  const ids = items.map((i: any) => i.id);
  const owned = await prisma.task.findMany({
    where: { id: { in: ids }, organizationId: orgId, assigneeId: userId },
    select: { id: true },
  });
  if (owned.length !== items.length) {
    return jsonError("One or more tasks aren't yours to reorder", 403);
  }

  await prisma.$transaction(
    items.map((it: { id: string; dayPosition: number }) =>
      prisma.task.update({
        where: { id: it.id },
        data: { dayPosition: it.dayPosition },
      })
    )
  );

  return jsonSuccess({ reordered: items.length });
}
