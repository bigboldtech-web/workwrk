import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("departmentId");
  const status = searchParams.get("status");
  const accessLevel = searchParams.get("accessLevel");
  const pagination = parsePaginationParams(req);

  const includeDeleted = searchParams.get("includeDeleted") === "true";
  const where: any = { organizationId: getOrgId(session) };
  if (!includeDeleted) where.deletedAt = null;
  if (departmentId) where.departmentId = departmentId;
  if (status) where.status = status;
  if (accessLevel) where.accessLevel = accessLevel;
  if (pagination.search) {
    where.OR = [
      { firstName: { contains: pagination.search, mode: "insensitive" } },
      { lastName: { contains: pagination.search, mode: "insensitive" } },
      { email: { contains: pagination.search, mode: "insensitive" } },
    ];
  }

  const orderBy: any = pagination.sortBy
    ? { [pagination.sortBy]: pagination.sortOrder }
    : { firstName: "asc" };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        phone: true,
        status: true,
        accessLevel: true,
        managerId: true,
        joinDate: true,
        deletedAt: true,
        department: { select: { id: true, name: true } },
        role: { select: { id: true, title: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { directReports: true, kraAssignments: true } },
      },
      orderBy,
      ...skipTake(pagination),
    }),
    prisma.user.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(users, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  // Plan limit enforcement
  const planCheck = await checkPlanLimit(getOrgId(session), "users");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  const body = await req.json();
  const { firstName, lastName, email, password, departmentId, roleId, accessLevel, managerId } = body;

  if (!firstName || !lastName || !email) {
    return jsonError("First name, last name, and email are required");
  }

  const existing = await prisma.user.findFirst({
    where: { email, organizationId: getOrgId(session) },
  });
  if (existing) return jsonError("A user with this email already exists");

  const passwordHash = await bcrypt.hash(password || "Welcome@123", 12);

  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      passwordHash,
      departmentId,
      roleId,
      accessLevel: accessLevel || "EMPLOYEE",
      managerId,
      organizationId: getOrgId(session),
    },
  });

  logActivity({
    type: "user_added",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Added new team member ${firstName} ${lastName}`,
    targetId: user.id,
    targetType: "user",
  });

  return jsonSuccess(user, 201);
}
