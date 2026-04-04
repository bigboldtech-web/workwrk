import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const quarter = url.searchParams.get("quarter");
  const ownerId = url.searchParams.get("ownerId");

  const where: any = { organizationId: orgId };
  if (level) where.level = level;
  if (quarter) {
    where.OR = [{ quarter }, { quarter: null }, { quarter: "" }];
  }
  if (ownerId) where.ownerId = ownerId;

  const okrs = await prisma.oKR.findMany({
    where,
    include: {
      keyResults: {
        include: { _count: { select: { checkIns: true } } },
        orderBy: { createdAt: "asc" },
      },
      children: { select: { id: true, title: true, progress: true, level: true, ownerId: true } },
    },
    orderBy: [{ level: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return jsonSuccess(okrs);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, description, level, quarter, startDate, endDate, ownerId, departmentId, parentId, keyResults } = body;

  if (!title?.trim()) return jsonError("Title required");

  const okr = await prisma.oKR.create({
    data: {
      title: title.trim(),
      description: description || null,
      level: level || "INDIVIDUAL",
      quarter: quarter || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      ownerId: ownerId || null,
      departmentId: departmentId || null,
      parentId: parentId || null,
      organizationId: orgId,
    },
  });

  // Create key results if provided
  if (Array.isArray(keyResults) && keyResults.length > 0) {
    await prisma.keyResult.createMany({
      data: keyResults.map((kr: any) => ({
        title: kr.title,
        unit: kr.unit || null,
        startValue: kr.startValue || 0,
        targetValue: kr.targetValue || 100,
        okrId: okr.id,
      })),
    });
  }

  const created = await prisma.oKR.findUnique({
    where: { id: okr.id },
    include: { keyResults: true },
  });

  logActivity({
    type: "okr_created",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Created OKR "${okr.title}" (${body.level || "INDIVIDUAL"})`,
    targetId: okr.id,
    targetType: "okr",
  });

  return jsonSuccess(created, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return jsonError("OKR ID required");

  const existing = await prisma.oKR.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("OKR not found", 404);

  if (updates.startDate) updates.startDate = new Date(updates.startDate);
  if (updates.endDate) updates.endDate = new Date(updates.endDate);

  const updated = await prisma.oKR.update({
    where: { id },
    data: updates,
    include: { keyResults: true },
  });

  return jsonSuccess(updated);
}
