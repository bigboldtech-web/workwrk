// GET    /api/template-center/[id]  template detail (incl. payload)
// PATCH  /api/template-center/[id]  rename or re-describe an org-owned template
// DELETE /api/template-center/[id]  remove an org-owned template (not built-in)
//
// PATCH exists because the spec's "Made here" row menu is Rename, Edit
// description and Delete, and only the third had a route: the other two had no
// door anywhere in the product.
//
// Who may delete, per spec-spaces-lists section 2 (/templates): the creator,
// an Admin or the Owner. It used to be any signed-in member of the org, so one
// person could delete a template somebody else saved.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { templatesAppGate } from "@/lib/templates/gate";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await templatesAppGate();
  if (denied) return denied;
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
  const denied = await templatesAppGate();
  if (denied) return denied;
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const tpl = await prisma.template.findFirst({
    where: { id },
    select: { organizationId: true, builtIn: true, createdById: true },
  });
  // A built-in row and a row in another org are both "not found": a delete
  // must never tell you a template exists somewhere you cannot see it.
  if (!tpl || tpl.organizationId !== orgId || tpl.builtIn) return jsonError("Not found", 404);

  const viewer = await viewerFromSession();
  if (!viewer) return jsonError("Unauthorized", 401);
  const isOrgAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  if (!isOrgAdmin && tpl.createdById !== viewer.userId) {
    return jsonError("Only the person who saved this template, an Admin or the Owner can delete it.", 403);
  }

  await prisma.template.delete({ where: { id } });
  return jsonSuccess({ ok: true });
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await templatesAppGate();
  if (denied) return denied;
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const tpl = await prisma.template.findFirst({
    where: { id },
    select: { organizationId: true, builtIn: true, createdById: true },
  });
  // Same answer as DELETE: a built-in row and a row in another org are both
  // "not found", so an edit never confirms a template exists out of reach.
  if (!tpl || tpl.organizationId !== orgId || tpl.builtIn) return jsonError("Not found", 404);

  const viewer = await viewerFromSession();
  if (!viewer) return jsonError("Unauthorized", 401);
  const isOrgAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  if (!isOrgAdmin && tpl.createdById !== viewer.userId) {
    return jsonError("Only the person who saved this template, an Admin or the Owner can edit it.", 403);
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid body", 400);
  const d = parsed.data;
  if (d.name === undefined && d.description === undefined) return jsonError("Nothing to change", 400);

  const row = await prisma.template.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name.trim() } : {}),
      ...(d.description !== undefined ? { description: d.description?.trim() || null } : {}),
    },
    select: { id: true, name: true, description: true },
  });
  return jsonSuccess({ template: row });
}
