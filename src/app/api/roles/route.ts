import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const roles = await prisma.role.findMany({
    where: { organizationId: getOrgId(session) },
    include: {
      department: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
    orderBy: { title: "asc" },
  });

  return jsonSuccess(roles, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { title, description, level, departmentId } = body;

  if (!title) return jsonError("Role title is required");

  const role = await prisma.role.create({
    data: {
      title,
      description,
      level: level || "EMPLOYEE",
      departmentId,
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(role, 201);
}
