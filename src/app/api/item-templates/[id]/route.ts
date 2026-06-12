// PATCH  /api/item-templates/[id] — rename / re-snapshot an existing template
// DELETE /api/item-templates/[id] — remove a template

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const existing = await prisma.template.findUnique({ where: { id }, select: { organizationId: true, kind: true } });
  if (!existing || existing.organizationId !== getOrgId(session) || existing.kind !== "TASK") return jsonError("Not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);

  const row = await prisma.template.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.config !== undefined ? { payload: parsed.data.config as object } : {}),
    },
    select: { id: true, name: true, payload: true },
  });
  return jsonSuccess({ template: { id: row.id, name: row.name, config: row.payload } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const existing = await prisma.template.findUnique({ where: { id }, select: { organizationId: true, kind: true } });
  if (!existing || existing.organizationId !== getOrgId(session) || existing.kind !== "TASK") return jsonError("Not found", 404);
  await prisma.template.delete({ where: { id } });
  return jsonSuccess({ ok: true });
}
