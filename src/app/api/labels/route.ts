import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

/**
 * Per-org task labels — small, slow-changing reference data. Every user
 * in the org can read them (powers the label picker on the task dialog);
 * only managers can create or delete them so the org's vocabulary doesn't
 * drift via accidental clicks.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const labels = await prisma.taskLabel.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(labels, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);

  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const color = typeof body?.color === "string" && body.color.startsWith("#") ? body.color : "#d4ff2e";
  if (!name) return jsonError("Label name is required");
  if (name.length > 40) return jsonError("Label name too long (max 40 chars)");

  try {
    const label = await prisma.taskLabel.create({
      data: { name, color, organizationId: orgId },
    });
    return jsonSuccess(label, 201);
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("Label already exists");
    return jsonError(err.message || "Failed to create label", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);

  const { id } = await req.json();
  if (!id) return jsonError("Label ID is required");

  const existing = await prisma.taskLabel.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return jsonError("Label not found", 404);

  await prisma.taskLabel.delete({ where: { id } });
  return jsonSuccess({ message: "Label deleted" });
}
