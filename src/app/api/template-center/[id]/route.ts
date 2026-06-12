// GET    /api/template-center/[id]  — template detail (incl. payload)
// DELETE /api/template-center/[id]  — remove an org-owned template (not built-in)

import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const template = await prisma.template.findFirst({
    where: { id, OR: [{ organizationId: orgId }, { builtIn: true }] },
  });
  if (!template) return jsonError("Not found", 404);
  return jsonSuccess({ template });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const tpl = await prisma.template.findFirst({ where: { id }, select: { organizationId: true, builtIn: true } });
  if (!tpl || tpl.organizationId !== orgId || tpl.builtIn) return jsonError("Not found", 404);
  await prisma.template.delete({ where: { id } });
  return jsonSuccess({ ok: true });
}
