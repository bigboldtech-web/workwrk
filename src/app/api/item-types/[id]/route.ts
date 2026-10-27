// PATCH  /api/item-types/[id] — edit a type (rename/icon/desc) or set as org default
// DELETE /api/item-types/[id] — remove a custom type (built-ins are protected)

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { itemTypeNameTaken } from "@/lib/item-types";

const patchSchema = z.object({
  singular: z.string().min(1).max(16).optional(),
  plural: z.string().min(1).max(16).optional(),
  icon: z.string().min(1).max(40).optional(),
  description: z.string().max(100).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Task types are the whole workspace's (Settings > Task system): only an
  // Owner or Admin may change them, on that page's rule with the account
  // re-read (settings-write.ts), as tags are, so an Admin demoted a moment
  // ago, or a tab showing another workspace, is refused now.
  const writeGate = await settingsWriteGate(session, "tasks");
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);
  const { id } = await params;
  const existing = await prisma.itemType.findFirst({ where: { id, organizationId: orgId }, select: { id: true, builtIn: true, singular: true } });
  if (!existing) return jsonError("Not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);
  const d = parsed.data;

  // Built-in types can be set as default but not renamed/deleted.
  if (existing.builtIn && (d.singular !== undefined || d.plural !== undefined || d.icon !== undefined)) {
    return jsonError("Built-in types can't be renamed", 400);
  }

  // A rename may not take a name another type holds, in any case (the same
  // refusal POST gives; settings-cleanup Phase 6 review, M1). Only a name
  // that changes is checked: a type stored twice before this rule can still
  // be edited, or made the default, under the name it already has.
  if (d.singular !== undefined) {
    const next = d.singular.trim();
    if (next.toLowerCase() !== existing.singular.toLowerCase()) {
      const clash = await prisma.itemType.findFirst({
        where: { organizationId: orgId, id: { not: id }, singular: { equals: next, mode: "insensitive" } },
        select: { singular: true },
      });
      if (clash) return jsonError(itemTypeNameTaken(clash.singular), 409);
    }
  }

  // Only one default per org — clear the others when promoting this one.
  if (d.isDefault === true) {
    await prisma.itemType.updateMany({ where: { organizationId: orgId, isDefault: true }, data: { isDefault: false } });
  }

  const type = await prisma.itemType.update({
    where: { id },
    data: {
      ...(d.singular !== undefined ? { singular: d.singular.trim() } : {}),
      ...(d.plural !== undefined ? { plural: d.plural.trim() } : {}),
      ...(d.icon !== undefined ? { icon: d.icon } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.isDefault !== undefined ? { isDefault: d.isDefault } : {}),
    },
  });
  return jsonSuccess({ type });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Task types are the whole workspace's (Settings > Task system): only an
  // Owner or Admin may change them, on that page's rule with the account
  // re-read (settings-write.ts), as tags are, so an Admin demoted a moment
  // ago, or a tab showing another workspace, is refused now.
  const writeGate = await settingsWriteGate(session, "tasks");
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);
  const { id } = await params;
  const existing = await prisma.itemType.findFirst({ where: { id, organizationId: orgId }, select: { id: true, builtIn: true } });
  if (!existing) return jsonError("Not found", 404);
  if (existing.builtIn) return jsonError("Built-in types can't be deleted", 400);

  // Null out the column on any items still using this type (they fall
  // back to the org default at read time).
  await prisma.item.updateMany({ where: { organizationId: orgId, itemTypeId: id }, data: { itemTypeId: null } });
  await prisma.itemType.delete({ where: { id } });
  return jsonSuccess({ ok: true });
}
