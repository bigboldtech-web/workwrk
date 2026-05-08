// Open enrollment windows — list + create. Org-admin only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const windows = await prisma.openEnrollment.findMany({
    where: { organizationId: orgId },
    orderBy: { startDate: "desc" },
    include: {
      _count: { select: { plans: true, enrollments: true } },
    },
  });
  return jsonSuccess(windows);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name is required");
  if (name.length > 120) return jsonError("name too long");

  const startDate = typeof body.startDate === "string" ? new Date(body.startDate) : null;
  const endDate = typeof body.endDate === "string" ? new Date(body.endDate) : null;
  const effectiveDate = typeof body.effectiveDate === "string" ? new Date(body.effectiveDate) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return jsonError("startDate required");
  if (!endDate || Number.isNaN(endDate.getTime())) return jsonError("endDate required");
  if (!effectiveDate || Number.isNaN(effectiveDate.getTime())) return jsonError("effectiveDate required");
  if (endDate <= startDate) return jsonError("endDate must be after startDate");

  const orgId = getOrgId(session);
  const window = await prisma.openEnrollment.create({
    data: {
      organizationId: orgId,
      name,
      startDate,
      endDate,
      effectiveDate,
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    },
  });
  return jsonSuccess(window, 201);
}
