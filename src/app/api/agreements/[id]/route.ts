import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: full agreement + parties (manager-gated).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const agreement = await prisma.agreement.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: { parties: { orderBy: { order: "asc" } } },
  });
  if (!agreement) return jsonError("Not found", 404);
  return jsonSuccess(agreement);
}

// PATCH: update title / content / fields / status (manager).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const existing = await prisma.agreement.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true } });
  if (!existing) return jsonError("Not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.fields !== undefined) data.fields = body.fields;
  if (body.status !== undefined) data.status = body.status;

  const updated = await prisma.agreement.update({ where: { id }, data });
  return jsonSuccess(updated);
}

// DELETE: remove an agreement (manager).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const existing = await prisma.agreement.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true } });
  if (!existing) return jsonError("Not found", 404);
  await prisma.agreement.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
