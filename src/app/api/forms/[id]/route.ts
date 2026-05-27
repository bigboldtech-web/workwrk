// GET    /api/forms/[id]                form + submission count
// PATCH  /api/forms/[id]                update name / fields / isPublic / targetBoardId
// DELETE /api/forms/[id]                soft-delete (hard for v1; submissions cascade)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const form = await prisma.formDefinition.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { submissions: true } } },
  });
  if (!form) return jsonError("not found", 404);

  return jsonSuccess({ ...form, submissionCount: form._count.submissions });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 200);
  if (typeof body.description === "string" || body.description === null) data.description = body.description?.slice?.(0, 2000) ?? null;
  if (Array.isArray(body.fields)) data.fields = body.fields;
  if (typeof body.isPublic === "boolean") data.isPublic = body.isPublic;
  if ("targetBoardId" in body) data.targetBoardId = typeof body.targetBoardId === "string" && body.targetBoardId ? body.targetBoardId : null;

  const updated = await prisma.formDefinition.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.formDefinition.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("not found", 404);

  await prisma.formDefinition.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
