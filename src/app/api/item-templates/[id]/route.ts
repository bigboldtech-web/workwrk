// PATCH  /api/item-templates/[id] — rename / re-snapshot an existing template
// DELETE /api/item-templates/[id] — remove a template

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";

/**
 * Who may change or remove a saved task template: the person who saved it,
 * an Admin or the Owner, the rule Template Center keeps for the same rows
 * (pen test 2026-11-28, V-11: this route checked the workspace only, so any
 * member rewrote or deleted the company's task templates, and every task made
 * from one carried the change). A built-in template is never changed here.
 */
async function templateRefusal(id: string, orgId: string): Promise<Response | null> {
  const existing = await prisma.template.findUnique({ where: { id }, select: { organizationId: true, kind: true, builtIn: true, createdById: true } });
  if (!existing || existing.organizationId !== orgId || existing.kind !== "TASK" || existing.builtIn) return jsonError("Not found", 404);
  const viewer = await viewerFromSession();
  if (!viewer) return jsonError("Unauthorized", 401);
  const isOrgAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  if (!isOrgAdmin && existing.createdById !== viewer.userId) {
    return jsonError("Only the person who saved this template, an Admin or the Owner can change it.", 403);
  }
  return null;
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const refused = await templateRefusal(id, getOrgId(session));
  if (refused) return refused;

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
  const refused = await templateRefusal(id, getOrgId(session));
  if (refused) return refused;
  await prisma.template.delete({ where: { id } });
  return jsonSuccess({ ok: true });
}
