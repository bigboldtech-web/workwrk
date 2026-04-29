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
  if (typeof body.icon === "string") data.icon = body.icon.slice(0, 32);
  if (body.icon === null) data.icon = null;
  if (typeof body.description === "string") data.description = body.description.slice(0, 500);

  // Re-parent (move folder under a different parent, or to root with null).
  if ("parentId" in body) {
    const next = body.parentId == null ? null : String(body.parentId);
    if (next === id) return jsonError("A folder cannot be its own parent");
    if (next) {
      const parent = await prisma.sOPFolder.findFirst({
        where: { id: next, organizationId: orgId },
        select: { id: true },
      });
      if (!parent) return jsonError("Parent folder not found", 404);
      // Refuse cycles: walk up the proposed parent's chain and make
      // sure `id` doesn't appear as an ancestor.
      const cycleCheck = await prisma.$queryRawUnsafe<{ id: string }[]>(`
        WITH RECURSIVE chain AS (
          SELECT id, "parentId" FROM "SOPFolder" WHERE id = $1::text
          UNION
          SELECT f.id, f."parentId" FROM "SOPFolder" f
            JOIN chain c ON f.id = c."parentId"
        )
        SELECT id FROM chain WHERE id = $2::text
      `, next, id);
      if (cycleCheck.length > 0) {
        return jsonError("Move would create a cycle", 400);
      }
    }
    data.parentId = next;
  }

  try {
    const updated = await prisma.sOPFolder.update({ where: { id }, data });
    return jsonSuccess(updated);
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("A folder with that name already exists at this level");
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
    select: {
      id: true, name: true,
      _count: { select: { sops: true, children: true } },
    },
  });
  if (!existing) return jsonError("Folder not found", 404);

  // Refuse to delete a folder that still has SOPs or sub-folders in
  // it. Admin must empty it first — prevents accidental un-scoping of
  // content that was meant to stay access-controlled.
  if (existing._count.sops > 0) {
    return jsonError(
      `"${existing.name}" still has ${existing._count.sops} SOP${existing._count.sops === 1 ? "" : "s"} in it. Move them out before deleting.`,
      409,
    );
  }
  if (existing._count.children > 0) {
    return jsonError(
      `"${existing.name}" still has ${existing._count.children} sub-folder${existing._count.children === 1 ? "" : "s"}. Delete or move them first.`,
      409,
    );
  }

  // Access rows cascade via schema.
  await prisma.sOPFolder.delete({ where: { id } });

  return jsonSuccess({ deleted: true });
}
