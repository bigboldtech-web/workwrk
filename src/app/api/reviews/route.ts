import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const pagination = parsePaginationParams(req);

  const where: any = { organizationId: getOrgId(session) };
  if (status) where.status = status;
  if (pagination.search) {
    where.name = { contains: pagination.search, mode: "insensitive" };
  }

  const [cycles, total] = await Promise.all([
    prisma.reviewCycle.findMany({
      where,
      include: {
        reviews: {
          select: {
            id: true,
            status: true,
            overallScore: true,
            outcome: true,
            subject: { select: { id: true, firstName: true, lastName: true } },
            reviewer: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        _count: { select: { reviews: true } },
      },
      orderBy: { startDate: "desc" },
      ...skipTake(pagination),
    }),
    prisma.reviewCycle.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(cycles, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { name, type, startDate, endDate } = body;

  if (!name || !type || !startDate || !endDate) {
    return jsonError("Name, type, start date and end date are required");
  }

  const cycle = await prisma.reviewCycle.create({
    data: {
      name,
      type,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(cycle, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { id, name, type, startDate, endDate, status } = body;

  if (!id) return jsonError("Cycle id is required");

  const existing = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("Review cycle not found", 404);

  const cycle = await prisma.reviewCycle.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(status !== undefined && { status }),
    },
  });

  return jsonSuccess(cycle);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("Cycle id is required");

  const existing = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("Review cycle not found", 404);

  await prisma.reviewCycle.delete({ where: { id } });

  return jsonSuccess({ message: "Review cycle deleted" });
}
