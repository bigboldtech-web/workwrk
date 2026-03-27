import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const departments = await prisma.department.findMany({
    where: { organizationId: getOrgId(session) },
    include: {
      head: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      _count: { select: { members: true } },
      subDepartments: true,
      goals: true,
    },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(departments);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { name, description, color, parentId, headId } = body;

  if (!name) return jsonError("Department name is required");

  const department = await prisma.department.create({
    data: {
      name,
      description,
      color,
      parentId,
      headId,
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(department, 201);
}
