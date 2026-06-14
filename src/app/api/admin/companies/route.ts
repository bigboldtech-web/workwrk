import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const plan = url.searchParams.get("plan") || "";
  const status = url.searchParams.get("status") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
      { domain: { contains: search, mode: "insensitive" } },
    ];
  }
  if (plan) where.plan = plan;
  if (status) where.status = status;

  const [companies, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        _count: {
          select: {
            users: true,
            tasks: true,
            sops: true,
            reviewCycles: true,
            kras: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.organization.count({ where }),
  ]);

  return jsonSuccess({
    companies,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

// Update organization (plan, status)
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const body = await req.json();
  const { id, plan, status } = body;

  if (!id) return jsonError("Organization ID required");

  const data: any = {};
  if (plan) data.plan = plan;
  if (status) data.status = status;

  const updated = await prisma.organization.update({
    where: { id },
    data,
  });

  return jsonSuccess(updated);
}
