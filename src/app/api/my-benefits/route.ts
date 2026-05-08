// Employee benefits self-service.
//
// GET  → returns the current user's enrollments, dependents, life
//        events, and any OPEN OpenEnrollment windows (with plans
//        available to elect).
// POST → creates a draft enrollment for the current user. Carrier
//        submission is a separate action once the user confirms.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const [enrollments, dependents, lifeEvents, openWindows] = await Promise.all([
    prisma.benefitEnrollment.findMany({
      where: { organizationId: orgId, subjectId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        benefitPlan: { select: { id: true, name: true, type: true, carrier: true } },
        benefitTier: { select: { id: true, tier: true } },
      },
    }),
    prisma.dependent.findMany({
      where: { organizationId: orgId, ownerId: userId },
      orderBy: { firstName: "asc" },
    }),
    prisma.lifeEvent.findMany({
      where: { organizationId: orgId, subjectId: userId },
      orderBy: { eventDate: "desc" },
    }),
    prisma.openEnrollment.findMany({
      where: { organizationId: orgId, status: "OPEN" },
      orderBy: { startDate: "desc" },
      include: {
        plans: {
          include: {
            benefitPlan: {
              select: {
                id: true, name: true, type: true, carrier: true,
                employeeCost: true, employerCost: true, description: true,
                tiers: { select: { id: true, tier: true, employeeCost: true, employerCost: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return jsonSuccess({
    enrollments,
    dependents,
    lifeEvents,
    openWindows: openWindows.map((w) => ({
      id: w.id,
      name: w.name,
      startDate: w.startDate,
      endDate: w.endDate,
      effectiveDate: w.effectiveDate,
      status: w.status,
      plans: w.plans.map((p) => p.benefitPlan),
    })),
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const benefitPlanId = typeof body.benefitPlanId === "string" ? body.benefitPlanId : "";
  const benefitTierId = typeof body.benefitTierId === "string" && body.benefitTierId
    ? body.benefitTierId
    : null;
  const openEnrollmentId = typeof body.openEnrollmentId === "string" && body.openEnrollmentId
    ? body.openEnrollmentId
    : null;
  if (!benefitPlanId) return jsonError("benefitPlanId required");

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // Validate plan + window belong to this org. Two-query check
  // — fast and explicit.
  const plan = await prisma.benefitPlan.findFirst({
    where: { id: benefitPlanId, organizationId: orgId },
    include: { tiers: true },
  });
  if (!plan) return jsonError("plan not found", 404);

  if (openEnrollmentId) {
    const w = await prisma.openEnrollment.findFirst({
      where: { id: openEnrollmentId, organizationId: orgId, status: "OPEN" },
    });
    if (!w) return jsonError("enrollment window is not open", 400);
  }

  // Tier costs win when set; otherwise plan defaults.
  const tier = benefitTierId ? plan.tiers.find((t) => t.id === benefitTierId) ?? null : null;
  const employeeCost = tier ? Number(tier.employeeCost) : Number(plan.employeeCost);
  const employerCost = tier ? Number(tier.employerCost) : Number(plan.employerCost);

  const effectiveStart = openEnrollmentId
    ? (await prisma.openEnrollment.findUnique({ where: { id: openEnrollmentId }, select: { effectiveDate: true } }))?.effectiveDate ?? new Date()
    : new Date();

  const enrollment = await prisma.benefitEnrollment.create({
    data: {
      organizationId: orgId,
      subjectId: userId,
      benefitPlanId,
      benefitTierId: tier?.id ?? null,
      openEnrollmentId,
      employeeCost,
      employerCost,
      effectiveStart,
      status: "DRAFT",
    },
  });
  return jsonSuccess(enrollment, 201);
}
