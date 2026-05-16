import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Batch-update OKR.position for a manual drag-reorder. Mirrors the
 * Idea reorder endpoint — see that file for the rationale.
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

  const ids = items.map((i: any) => i.id);
  const owned = await prisma.oKR.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true },
  });
  if (owned.length !== items.length) {
    return jsonError("One or more OKRs are not in your organization", 403);
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
