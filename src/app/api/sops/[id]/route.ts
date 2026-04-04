import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { broadcastWebhook } from "@/lib/webhooks";

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

  return jsonSuccess(sop);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("SOP not found", 404);

  const body = await req.json();
  const { title, description, category, content, status, version } = body;

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (category !== undefined) data.category = category;
  if (content !== undefined) data.content = content;
  if (version !== undefined) data.version = version;

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

  return jsonSuccess(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("SOP not found", 404);

  await prisma.sOP.delete({ where: { id } });

  return jsonSuccess({ success: true });
}
