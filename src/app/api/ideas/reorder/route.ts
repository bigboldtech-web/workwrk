import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Batch-update Idea.position for a manual drag-reorder.
 *
 * Body: `{ items: [{ id: string, position: number }, ...] }`
 *
 * All updates are wrapped in a single transaction so the list is
 * either fully reordered or unchanged — no half-states. We also
 * scope every Idea ID to the caller's organization to refuse
 * cross-tenant writes even when an ID happens to collide.
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

  // Ownership guard — every ID must belong to this org before we
  // accept the batch.
  const ids = items.map((i: any) => i.id);
  const owned = await prisma.idea.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true },
  });
  if (owned.length !== items.length) {
    return jsonError("One or more ideas are not in your organization", 403);
  }

  await prisma.$transaction(
    items.map((it: { id: string; position: number }) =>
      prisma.idea.update({
        where: { id: it.id },
        data: { position: it.position },
      })
    )
  );

  return jsonSuccess({ reordered: items.length });
}
