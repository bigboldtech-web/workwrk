// Tag rename / archive / delete. Admin only. Deletion cascades
// assignments (Prisma onDelete: Cascade), so a soft-archive is
// the safer path for any tag that's already in flight on records;
// we expose both and let the UI pick.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const tag = await prisma.tag.findFirst({ where: { id, organizationId: orgId } });
  if (!tag) return jsonError("Tag not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return jsonError("name cannot be empty");
    if (name.length > 80) return jsonError("name must be 80 chars or fewer");
    data.name = name;
  }
  if (typeof body.color === "string") data.color = body.color.trim() || null;
  if (typeof body.description === "string") {
    data.description = body.description.trim() || null;
  }
  if (typeof body.archived === "boolean") data.archived = body.archived;

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.tag.update({
    where: { id },
    data,
  });
  return jsonSuccess(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const tag = await prisma.tag.findFirst({ where: { id, organizationId: orgId } });
  if (!tag) return jsonError("Tag not found", 404);

  await prisma.tag.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
