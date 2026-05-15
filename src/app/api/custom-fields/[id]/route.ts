// PATCH / DELETE for a single custom field definition. PATCH is the
// only way to update `position` (used by drag-reorder in /studio) and
// to flip `active`. DELETE is hard-delete; the schema cascades any
// stored values via the FK on CustomFieldValue.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

async function loadOwn(id: string, orgId: string) {
  // Always scope by orgId so a field id from another tenant can't be
  // reached even if the caller guesses the cuid.
  return prisma.customFieldDefinition.findFirst({ where: { id, organizationId: orgId } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;
  const existing = await loadOwn(id, orgId);
  if (!existing) return jsonError("Not found", 404);

  const body = await req.json().catch(() => ({}));

  // Whitelist updatable fields. `key`, `targetType`, and `fieldType`
  // are intentionally not patchable here — changing those after data
  // exists would orphan stored values.
  const data: {
    label?: string;
    required?: boolean;
    active?: boolean;
    position?: number;
  } = {};

  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) return jsonError("label cannot be empty");
    if (label.length > 80) return jsonError("label too long");
    data.label = label;
  }
  if (typeof body.required === "boolean") data.required = body.required;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.position === "number" && Number.isFinite(body.position)) {
    data.position = Math.max(0, Math.floor(body.position));
  }

  if (Object.keys(data).length === 0) return jsonError("No updatable fields supplied");

  const updated = await prisma.customFieldDefinition.update({
    where: { id },
    data,
  });
  return jsonSuccess(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;
  const existing = await loadOwn(id, orgId);
  if (!existing) return jsonError("Not found", 404);

  await prisma.customFieldDefinition.delete({ where: { id } });
  return jsonSuccess({ deleted: id });
}
