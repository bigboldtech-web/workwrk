import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

const AUDIENCE_TYPES = new Set(["ALL", "OFFICES", "DEPARTMENTS", "USERS"]);
const STATUSES = new Set(["DRAFT", "ACTIVE", "CLOSED"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return jsonError("Survey not found", 404);

  const body = await req.json();
  const data: any = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();

  if (Array.isArray(body.questions)) {
    const cleaned = body.questions.filter((q: any) => q && typeof q.text === "string" && q.text.trim());
    if (cleaned.length === 0) return jsonError("At least one question is required");
    data.questions = cleaned;
  }

  if (typeof body.frequency === "string" || body.frequency === null) {
    data.frequency = body.frequency || null;
  }

  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status)) return jsonError("Invalid status");
    data.status = body.status;
    data.closedAt = body.status === "CLOSED" ? new Date() : null;
  }

  if (typeof body.audienceType === "string") {
    if (!AUDIENCE_TYPES.has(body.audienceType)) return jsonError("Invalid audienceType");
    data.audienceType = body.audienceType;

    const officeIds = body.audienceType === "OFFICES" && Array.isArray(body.officeIds)
      ? body.officeIds.filter((x: unknown) => typeof x === "string") : [];
    const departmentIds = body.audienceType === "DEPARTMENTS" && Array.isArray(body.departmentIds)
      ? body.departmentIds.filter((x: unknown) => typeof x === "string") : [];
    const userIds = body.audienceType === "USERS" && Array.isArray(body.userIds)
      ? body.userIds.filter((x: unknown) => typeof x === "string") : [];

    if (body.audienceType === "OFFICES" && officeIds.length === 0) return jsonError("Pick at least one office");
    if (body.audienceType === "DEPARTMENTS" && departmentIds.length === 0) return jsonError("Pick at least one department");
    if (body.audienceType === "USERS" && userIds.length === 0) return jsonError("Pick at least one user");

    if (officeIds.length > 0) {
      const valid = await prisma.office.findMany({ where: { id: { in: officeIds }, organizationId: orgId }, select: { id: true } });
      if (valid.length !== officeIds.length) return jsonError("One or more offices invalid");
    }
    if (departmentIds.length > 0) {
      const valid = await prisma.department.findMany({ where: { id: { in: departmentIds }, organizationId: orgId }, select: { id: true } });
      if (valid.length !== departmentIds.length) return jsonError("One or more departments invalid");
    }
    if (userIds.length > 0) {
      const valid = await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId, deletedAt: null }, select: { id: true } });
      if (valid.length !== userIds.length) return jsonError("One or more users invalid");
    }

    data.officeIds = officeIds;
    data.departmentIds = departmentIds;
    data.userIds = userIds;
  }

  const updated = await prisma.pulseSurvey.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

  const existing = await prisma.pulseSurvey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return jsonError("Survey not found", 404);

  // Responses cascade via schema (onDelete: Cascade on SurveyResponse.survey)
  await prisma.pulseSurvey.delete({ where: { id } });
  return jsonSuccess({ message: "Deleted" });
}
