import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Individual folder — rename / describe / recolor / delete.
 * All mutations gated to org admins; reads are gated to anyone with
 * access to the folder.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const folder = await prisma.sOPFolder.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true, name: true, color: true, description: true,
      createdAt: true, updatedAt: true,
      _count: { select: { sops: true, access: true } },
    },
  });
  if (!folder) return jsonError("Folder not found", 404);

  if (!isOrgAdmin(session)) {
    const hasAccess = await prisma.sOPFolderAccess.findUnique({
      where: { folderId_userId: { folderId: id, userId: (session.user as any).id } },
      select: { folderId: true },
    });
    if (!hasAccess) return jsonError("Forbidden", 403);
  }

  return jsonSuccess(folder);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can edit folders", 403);
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.sOPFolder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return jsonError("Folder not found", 404);

  const body = await req.json();
  const data: any = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return jsonError("Name required");
    if (name.length > 60) return jsonError("Name too long");
    data.name = name;
  }
  if (typeof body.color === "string" && body.color.startsWith("#")) data.color = body.color;
  if (body.color === null) data.color = null;
  if (typeof body.description === "string") data.description = body.description.slice(0, 500);

  try {
    const updated = await prisma.sOPFolder.update({ where: { id }, data });
    return jsonSuccess(updated);
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("A folder with that name already exists");
    return jsonError(err.message || "Failed to update folder", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can delete folders", 403);
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.sOPFolder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, _count: { select: { sops: true } } },
  });
  if (!existing) return jsonError("Folder not found", 404);

  // SOPs in the folder have `folder.onDelete: SetNull`, so deleting the
  // folder un-scopes its SOPs rather than destroying them. Access rows
  // cascade via schema.
  await prisma.sOPFolder.delete({ where: { id } });

  return jsonSuccess({ deleted: true, unfolderedSops: existing._count.sops });
}
