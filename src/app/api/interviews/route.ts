// Interviews — list + schedule. Manager+ only (PII-adjacent).
//
// scope:
//   "mine"     → interviews where I'm the interviewer (default for
//                managers — drives "my upcoming interviews" inbox).
//   "app"      → interviews on a specific ?applicationId=
//   "upcoming" → org-wide upcoming (manager+ only, last 30 / next 60)
//   "all"      → unrestricted org list (manager+)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

const VALID_TYPES = new Set(["SCREEN", "TECHNICAL", "BEHAVIORAL", "ONSITE", "FINAL", "OTHER"]);
const VALID_STATUS = new Set(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "mine";
  const applicationId = sp.get("applicationId");
  const status = sp.get("status");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 200);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (scope === "mine") where.interviewerId = userId;
  else if (scope === "app") {
    if (!applicationId) return jsonError("applicationId required");
    where.applicationId = applicationId;
  } else if (scope === "upcoming") {
    where.scheduledAt = {
      gte: new Date(Date.now() - 30 * DAY_MS),
      lte: new Date(Date.now() + 60 * DAY_MS),
    };
  } else if (scope !== "all") {
    return jsonError("Invalid scope");
  }

  if (status) {
    if (!VALID_STATUS.has(status)) return jsonError("Invalid status");
    where.status = status;
  }

  const interviews = await prisma.interview.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    take: limit,
    include: {
      interviewer: { select: { id: true, firstName: true, lastName: true, email: true } },
      application: {
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          job: { select: { id: true, title: true } },
        },
      },
    },
  });

  return jsonSuccess(interviews);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  const interviewerId = typeof body.interviewerId === "string" ? body.interviewerId : "";
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  const durationMinutes = Math.max(5, Math.min(480, Number(body.durationMinutes) || 30));
  const type = typeof body.type === "string" ? body.type : "SCREEN";
  const location = typeof body.location === "string" ? body.location.trim() || null : null;

  if (!applicationId) return jsonError("applicationId is required");
  if (!interviewerId) return jsonError("interviewerId is required");
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) return jsonError("Invalid scheduledAt");
  if (!VALID_TYPES.has(type)) return jsonError("Invalid type");

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const [application, interviewer] = await Promise.all([
    prisma.application.findFirst({
      where: { id: applicationId, organizationId: orgId },
      include: {
        candidate: { select: { firstName: true, lastName: true } },
        job: { select: { title: true, status: true } },
      },
    }),
    prisma.user.findFirst({
      where: { id: interviewerId, organizationId: orgId },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  if (!application) return jsonError("Application not found", 404);
  if (!interviewer) return jsonError("Interviewer not found", 404);

  // Refuse scheduling on terminated applications. Open Job constraint
  // is also worth it — a closed Job can't have new interviews.
  if (application.stage === "HIRED" || application.stage === "REJECTED" || application.stage === "WITHDRAWN") {
    return jsonError(`Application is ${application.stage} — cannot schedule new interview`, 409);
  }

  const interview = await prisma.interview.create({
    data: {
      organizationId: orgId,
      applicationId,
      interviewerId,
      scheduledAt,
      durationMinutes,
      type: type as never,
      location,
    },
  });

  // Auto-advance application to INTERVIEW stage if it's still APPLIED
  // or SCREENING. Common case: scheduling the first interview is
  // also when a candidate moves out of "phone screen."
  if (application.stage === "APPLIED" || application.stage === "SCREENING") {
    await prisma.application.update({
      where: { id: applicationId },
      data: { stage: "INTERVIEW" },
    });
  }

  logActivity({
    type: "interview_scheduled",
    actorId: userId,
    organizationId: orgId,
    description: `Scheduled ${type.toLowerCase()} interview with ${application.candidate.firstName} ${application.candidate.lastName} (${interviewer.firstName} ${interviewer.lastName})`,
    targetId: interview.id,
    targetType: "interview",
  });

  return jsonSuccess(interview, 201);
}
