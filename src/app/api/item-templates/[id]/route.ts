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
  const existing = await prisma.itemTemplate.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== getOrgId(session)) return jsonError("Not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);

  const template = await prisma.itemTemplate.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.config !== undefined ? { config: parsed.data.config as object } : {}),
    },
  });
  return jsonSuccess({ template });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const existing = await prisma.itemTemplate.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== getOrgId(session)) return jsonError("Not found", 404);
  await prisma.itemTemplate.delete({ where: { id } });
  return jsonSuccess({ ok: true });
}
