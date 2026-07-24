import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// Threshold — a tunable value that drives automation, stored as a row.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const roleId = req.nextUrl.searchParams.get("roleId");
  const rows = await prisma.threshold.findMany({
    where: { organizationId: getOrgId(session), ...(roleId ? { roleId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return jsonSuccess(rows);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const trigger = typeof body.trigger === "string" ? body.trigger.trim() : "";
  const value = typeof body.value === "number" ? body.value : Number(body.value);
  if (!label) return jsonError("Threshold label is required");
  if (!trigger) return jsonError("Threshold trigger is required");
  if (!Number.isFinite(value)) return jsonError("Threshold value must be a number");

  const row = await prisma.threshold.create({
    data: {
      label,
      trigger,
      value,
      unit: body.unit ?? null,
      businessHoursOnly: body.businessHoursOnly ?? true,
      roleId: body.roleId ?? null,
      organizationId: getOrgId(session),
    },
  });
  return jsonSuccess(row, 201);
}
