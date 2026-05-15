import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "instances"; // "instances" or "templates"

  if (type === "templates") {
    const templates = await prisma.onboardingTemplate.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { instances: true } } },
      orderBy: { createdAt: "desc" },
    });
    return jsonSuccess(templates);
  }

  // `?mine=true` scopes the result to instances assigned to the caller.
  // Used by the /onboarding/me page so a new hire sees only their own
  // active journeys instead of the org-wide list.
  const mineOnly = url.searchParams.get("mine") === "true";
  const userId = getUserId(session);

  const instances = await prisma.onboardingInstance.findMany({
    where: {
      template: { organizationId: orgId },
      ...(mineOnly ? { userId } : {}),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
      buddy: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
      template: { select: { name: true, steps: true, durationDays: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(instances);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();

  // Create template
  if (body.type === "template") {
    const { name, description, steps, durationDays, roleId, departmentId } = body;
    if (!name) return jsonError("Name is required");

    const template = await prisma.onboardingTemplate.create({
      data: { name, description, steps: steps || [], durationDays: durationDays || 30, roleId, departmentId, organizationId: orgId },
    });
    return jsonSuccess(template, 201);
  }

  // Create instance (assign onboarding to user)
  const { templateId, userId, buddyId } = body;
  if (!templateId || !userId) return jsonError("templateId and userId are required");

  const template = await prisma.onboardingTemplate.findUnique({ where: { id: templateId } });
  if (!template) return jsonError("Template not found", 404);

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + template.durationDays);

  const instance = await prisma.onboardingInstance.create({
    data: { templateId, userId, buddyId, targetDate, progress: [] },
    include: {
      user: { select: { firstName: true, lastName: true } },
      template: { select: { name: true } },
    },
  });

  logActivity({
    type: "onboarding_started",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Started onboarding "${instance.template.name}" for ${instance.user.firstName} ${instance.user.lastName}`,
    targetId: instance.id,
    targetType: "onboarding",
  });

  return jsonSuccess(instance, 201);
}
