import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, isOrgAdmin, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { broadcastWebhook } from "@/lib/webhooks";
import { enrichScribeScreenshots } from "@/lib/scribe-enrich";
import { canWriteToFolder } from "@/lib/sop-access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const sop = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
    include: {
      compliance: {
        take: 20,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!sop) return jsonError("SOP not found", 404);

  // Folder-scoped visibility. Admin sees all; everyone else must either
  // be looking at an unfoldered SOP or have been granted folder access.
  if (sop.folderId && !isOrgAdmin(session)) {
    const access = await prisma.sOPFolderAccess.findUnique({
      where: { folderId_userId: { folderId: sop.folderId, userId: (session.user as any).id } },
      select: { folderId: true },
    });
    if (!access) return jsonError("SOP not found", 404);
  }

  const enriched = await enrichScribeScreenshots(sop as any);
  return jsonSuccess(enriched);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "edit");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("SOP not found", 404);

  // Write access to the existing folder is required before any mutation.
  if (!(await canWriteToFolder(session, existing.folderId))) {
    return jsonError("You don't have access to this SOP's folder", 403);
  }

  const body = await req.json();
  const { title, description, category, content, status, version, folderId } = body;

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (category !== undefined) data.category = category;
  if (content !== undefined) data.content = content;
  if (version !== undefined) data.version = version;

  // Moving between folders requires write access on the target too.
  // Moving TO the unfoldered bucket (null) is allowed for anyone with
  // write access on the current folder.
  if (folderId !== undefined) {
    const next: string | null = folderId || null;
    if (next) {
      const folder = await prisma.sOPFolder.findFirst({
        where: { id: next, organizationId: orgId },
        select: { id: true },
      });
      if (!folder) return jsonError("Target folder not found", 404);
      if (!(await canWriteToFolder(session, next))) {
        return jsonError("You don't have access to the target folder", 403);
      }
    }
    data.folderId = next;
  }

  if (status !== undefined) {
    data.status = status;
    if (status === "PUBLISHED") {
      data.publishedAt = new Date();
      // Save version snapshot before updating
      await prisma.sOPVersion.create({
        data: {
          sopId: id,
          version: existing.version,
          title: existing.title,
          description: existing.description,
          content: existing.content as any,
          publishedBy: getUserId(session),
        },
      });
    }
  }

  const updated = await prisma.sOP.update({
    where: { id },
    data,
    include: {
      compliance: {
        take: 20,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    broadcastWebhook({
      organizationId: getOrgId(session),
      event: "sop_published",
      payload: { sopId: id, title: updated.title, category: updated.category },
    });
  }

  const enriched = await enrichScribeScreenshots(updated as any);
  return jsonSuccess(enriched);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "delete");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("SOP not found", 404);

  // Folder write access required to delete.
  if (!(await canWriteToFolder(session, existing.folderId))) {
    return jsonError("You don't have access to this SOP's folder", 403);
  }

  await prisma.sOP.delete({ where: { id } });

  return jsonSuccess({ success: true });
}
