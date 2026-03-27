import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const kraId = searchParams.get("kraId");
  const userId = searchParams.get("userId");

  const where: any = { organizationId: getOrgId(session) };
  if (kraId) where.kraId = kraId;

  const kpis = await prisma.kPI.findMany({
    where,
    include: {
      kra: { select: { id: true, name: true } },
      records: userId ? {
        where: { userId },
        orderBy: { period: "desc" },
        take: 6,
      } : false,
    },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(kpis);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { name, description, type, unit, frequency, kraId } = body;

  if (!name) return jsonError("KPI name is required");

  const kpi = await prisma.kPI.create({
    data: {
      name,
      description,
      type: type || "QUANTITATIVE",
      unit,
      frequency: frequency || "MONTHLY",
      kraId,
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(kpi, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { id, name, description, type, unit, frequency, kraId } = body;

  if (!id) return jsonError("KPI id is required");

  const existing = await prisma.kPI.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("KPI not found", 404);

  const kpi = await prisma.kPI.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(type !== undefined && { type }),
      ...(unit !== undefined && { unit }),
      ...(frequency !== undefined && { frequency }),
      ...(kraId !== undefined && { kraId: kraId || null }),
    },
  });

  return jsonSuccess(kpi);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("KPI id is required");

  const existing = await prisma.kPI.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("KPI not found", 404);

  await prisma.kPI.delete({ where: { id } });

  return jsonSuccess({ message: "KPI deleted" });
}
