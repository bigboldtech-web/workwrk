import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.threshold.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!row) return jsonError("Threshold not found", 404);

  const body = await req.json().catch(() => ({}));
  const value = body.value !== undefined ? Number(body.value) : undefined;
  if (value !== undefined && !Number.isFinite(value)) return jsonError("value must be a number");
  const updated = await prisma.threshold.update({
    where: { id },
    data: {
      label: typeof body.label === "string" ? body.label.trim() : undefined,
      trigger: typeof body.trigger === "string" ? body.trigger.trim() : undefined,
      value,
      unit: body.unit !== undefined ? body.unit : undefined,
      businessHoursOnly: body.businessHoursOnly !== undefined ? body.businessHoursOnly : undefined,
    },
  });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.threshold.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!row) return jsonError("Threshold not found", 404);
  await prisma.threshold.delete({ where: { id } });
  return jsonSuccess({ message: "Threshold deleted" });
}
