import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

const AUDIENCE_TYPES = new Set(["ALL", "OFFICES", "DEPARTMENTS", "USERS"]);

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, officeId: true, departmentId: true, accessLevel: true },
  });
  const viewerIsManager = isManager(session);

  const surveys = await prisma.pulseSurvey.findMany({
    where: { organizationId: orgId },
    include: {
      responses: { where: { userId }, select: { id: true } },
      _count: { select: { responses: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const totalUsers = await prisma.user.count({ where: { organizationId: orgId, deletedAt: null } });

  // Count audience size per survey (for response rate)
  async function audienceSize(s: typeof surveys[number]): Promise<number> {
    if (s.audienceType === "ALL") return totalUsers;
    const where: any = { organizationId: orgId, deletedAt: null };
    if (s.audienceType === "OFFICES") where.officeId = { in: s.officeIds };
    if (s.audienceType === "DEPARTMENTS") where.departmentId = { in: s.departmentIds };
    if (s.audienceType === "USERS") where.id = { in: s.userIds };
    return prisma.user.count({ where });
  }

  function viewerIsInAudience(s: typeof surveys[number]) {
    if (s.audienceType === "ALL") return true;
    if (s.audienceType === "OFFICES") return !!viewer?.officeId && s.officeIds.includes(viewer.officeId);
    if (s.audienceType === "DEPARTMENTS") return !!viewer?.departmentId && s.departmentIds.includes(viewer.departmentId);
    if (s.audienceType === "USERS") return s.userIds.includes(userId);
    return false;
  }

  const sizes = await Promise.all(surveys.map(audienceSize));

  const shaped = surveys
    .map((s, i) => ({ survey: s, size: sizes[i] }))
    .filter(({ survey }) => viewerIsManager || viewerIsInAudience(survey))
    .map(({ survey: s, size }) => ({
      ...s,
      hasResponded: s.responses.length > 0,
      inAudience: viewerIsInAudience(s),
      audienceSize: size,
      responseRate: size > 0 ? Math.round((s._count.responses / size) * 100) : 0,
      totalResponses: s._count.responses,
      totalUsers,
    }));

  return jsonSuccess(shaped);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, questions, frequency, audienceType, officeIds, departmentIds, userIds } = body;

  if (!title?.trim() || !Array.isArray(questions) || questions.length === 0) {
    return jsonError("Title and questions required");
  }

  const resolvedAudienceType = typeof audienceType === "string" && AUDIENCE_TYPES.has(audienceType) ? audienceType : "ALL";
  const resolvedOfficeIds = resolvedAudienceType === "OFFICES" && Array.isArray(officeIds) ? officeIds.filter((x: unknown) => typeof x === "string") : [];
  const resolvedDepartmentIds = resolvedAudienceType === "DEPARTMENTS" && Array.isArray(departmentIds) ? departmentIds.filter((x: unknown) => typeof x === "string") : [];
  const resolvedUserIds = resolvedAudienceType === "USERS" && Array.isArray(userIds) ? userIds.filter((x: unknown) => typeof x === "string") : [];

  if (resolvedAudienceType === "OFFICES" && resolvedOfficeIds.length === 0) return jsonError("Pick at least one office");
  if (resolvedAudienceType === "DEPARTMENTS" && resolvedDepartmentIds.length === 0) return jsonError("Pick at least one department");
  if (resolvedAudienceType === "USERS" && resolvedUserIds.length === 0) return jsonError("Pick at least one user");

  // Validate IDs belong to the org
  if (resolvedOfficeIds.length > 0) {
    const valid = await prisma.office.findMany({ where: { id: { in: resolvedOfficeIds }, organizationId: orgId }, select: { id: true } });
    if (valid.length !== resolvedOfficeIds.length) return jsonError("One or more offices invalid", 400);
  }
  if (resolvedDepartmentIds.length > 0) {
    const valid = await prisma.department.findMany({ where: { id: { in: resolvedDepartmentIds }, organizationId: orgId }, select: { id: true } });
    if (valid.length !== resolvedDepartmentIds.length) return jsonError("One or more departments invalid", 400);
  }
  if (resolvedUserIds.length > 0) {
    const valid = await prisma.user.findMany({ where: { id: { in: resolvedUserIds }, organizationId: orgId, deletedAt: null }, select: { id: true } });
    if (valid.length !== resolvedUserIds.length) return jsonError("One or more users invalid", 400);
  }

  const survey = await prisma.pulseSurvey.create({
    data: {
      title: title.trim(),
      questions: questions as any,
      frequency: frequency || null,
      status: "ACTIVE",
      audienceType: resolvedAudienceType,
      officeIds: resolvedOfficeIds,
      departmentIds: resolvedDepartmentIds,
      userIds: resolvedUserIds,
      organizationId: orgId,
    },
  });

  return jsonSuccess(survey, 201);
}
