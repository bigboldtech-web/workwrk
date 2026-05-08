// Edit / archive a time-off policy. Archive instead of hard-delete
// when the policy has any requests pinned to it — keeps history.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const policy = await prisma.timeOffPolicy.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!policy) return jsonError("Policy not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return jsonError("name cannot be empty");
    if (name.length > 80) return jsonError("name too long");
    data.name = name;
  }
  if (body.color !== undefined) {
    data.color = typeof body.color === "string" ? body.color.trim() || null : null;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.annualHours !== undefined) {
    const num = Number(body.annualHours);
    if (!Number.isFinite(num) || num < 0 || num > 100_000) return jsonError("Invalid annualHours");
    data.annualHours = num;
  }
  if (body.carryoverHours !== undefined) {
    const num = Number(body.carryoverHours);
    if (!Number.isFinite(num) || num < 0) return jsonError("Invalid carryoverHours");
    data.carryoverHours = num;
  }
  if (typeof body.requiresApproval === "boolean") data.requiresApproval = body.requiresApproval;
  if (typeof body.archived === "boolean") data.archived = body.archived;

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.timeOffPolicy.update({ where: { id }, data });
  return jsonSuccess({
    ...updated,
    annualHours: Number(updated.annualHours),
    carryoverHours: Number(updated.carryoverHours),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const policy = await prisma.timeOffPolicy.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { requests: true } } },
  });
  if (!policy) return jsonError("Policy not found", 404);

  if (policy._count.requests > 0) {
    return jsonError(
      "This policy has time-off requests pinned to it. Archive instead of deleting.",
      409,
    );
  }

  await prisma.timeOffPolicy.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
