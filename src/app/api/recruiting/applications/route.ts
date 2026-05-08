// Applications — list + create. Creating an application links a
// Candidate to a Job at stage APPLIED. Manager+ only (PII).
//
// scope:
//   "all"     → org-wide pipeline (default)
//   "mine"    → applications I'm the recruiter on
//   "job"     → applications for ?jobId=
//
// Stage filters take a comma-separated list; the kanban view passes
// every stage in one query and groups client-side.

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

const VALID_STAGES = new Set([
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "all";
  const jobId = sp.get("jobId");
  const stagesRaw = sp.get("stages");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 200)), 500);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (scope === "mine") where.recruiterId = userId;
  else if (scope === "job") {
    if (!jobId) return jsonError("jobId required for scope=job");
    where.jobId = jobId;
  } else if (scope !== "all") return jsonError("Invalid scope");

  if (stagesRaw) {
    const stages = stagesRaw.split(",").map((s) => s.trim()).filter((s) => VALID_STAGES.has(s));
    if (stages.length > 0) where.stage = { in: stages };
  }

  const apps = await prisma.application.findMany({
    where,
    orderBy: [{ stage: "asc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      stage: true,
      rejectionReason: true,
      source: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      job: { select: { id: true, title: true } },
      candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
      recruiter: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return jsonSuccess(apps);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  const recruiterId = typeof body.recruiterId === "string" ? body.recruiterId : null;
  const source = typeof body.source === "string" ? body.source.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  if (!jobId || !candidateId) return jsonError("jobId and candidateId are required");

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // Both must belong to caller's org.
  const [job, candidate] = await Promise.all([
    prisma.job.findFirst({
      where: { id: jobId, organizationId: orgId },
      select: { id: true, status: true, title: true },
    }),
    prisma.candidate.findFirst({
      where: { id: candidateId, organizationId: orgId },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  if (!job) return jsonError("Job not found", 404);
  if (!candidate) return jsonError("Candidate not found", 404);
  if (job.status === "CLOSED" || job.status === "FILLED") {
    return jsonError(`Cannot apply to a ${job.status} job`, 409);
  }

  const existing = await prisma.application.findUnique({
    where: { jobId_candidateId: { jobId, candidateId } },
    select: { id: true, stage: true },
  });
  if (existing) {
    return jsonError(`This candidate is already on this job (${existing.stage})`, 409);
  }

  // Validate recruiter belongs to org if supplied.
  let validatedRecruiterId: string | null = null;
  if (recruiterId) {
    const r = await prisma.user.findFirst({
      where: { id: recruiterId, organizationId: orgId },
      select: { id: true },
    });
    validatedRecruiterId = r?.id ?? null;
  }

  const app = await prisma.application.create({
    data: {
      organizationId: orgId,
      jobId,
      candidateId,
      stage: "APPLIED",
      source,
      notes,
      recruiterId: validatedRecruiterId,
    },
  });

  logActivity({
    type: "application_created",
    actorId: userId,
    organizationId: orgId,
    description: `${candidate.firstName} ${candidate.lastName} applied to "${job.title}"`,
    targetId: app.id,
    targetType: "application",
  });

  return jsonSuccess(app, 201);
}
