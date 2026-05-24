// Jobs (requisitions) — list + create. Manager+ create; everyone in
// the org can read open jobs (so internal mobility / referrals work).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

const VALID_STATUS = new Set(["DRAFT", "OPEN", "ON_HOLD", "CLOSED", "FILLED"]);
const VALID_TYPE = new Set(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const departmentId = sp.get("departmentId");
  const search = sp.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 200);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (status) {
    if (!VALID_STATUS.has(status)) return jsonError("Invalid status");
    where.status = status;
  }
  if (departmentId) where.departmentId = departmentId;
  if (search) where.title = { contains: search, mode: "insensitive" };
  const workspaceId = sp.get("workspace");
  if (workspaceId) where.OR = [{ workspaceId }, { workspaceId: null }];

  const jobs = await prisma.job.findMany({
    where,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      employmentType: true,
      location: true,
      openings: true,
      publishedAt: true,
      closedAt: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      department: { select: { id: true, name: true } },
      hiringManager: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { applications: true } },
    },
  });

  const serialized = jobs.map((j) => ({
    ...j,
    salaryMin: j.salaryMin === null ? null : Number(j.salaryMin),
    salaryMax: j.salaryMax === null ? null : Number(j.salaryMax),
  }));
  return jsonSuccess(serialized);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return jsonError("title is required");
  if (title.length > 200) return jsonError("title too long");

  const employmentType = typeof body.employmentType === "string" ? body.employmentType : "FULL_TIME";
  if (!VALID_TYPE.has(employmentType)) return jsonError("Invalid employmentType");

  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const location = typeof body.location === "string" ? body.location.trim() || null : null;
  const departmentId = typeof body.departmentId === "string" ? body.departmentId : null;
  const hiringManagerId = typeof body.hiringManagerId === "string" ? body.hiringManagerId : null;

  const openings = body.openings === undefined || body.openings === null
    ? 1
    : Math.max(1, Math.min(10_000, Number(body.openings) || 1));

  const salaryCurrency = (typeof body.salaryCurrency === "string"
    ? body.salaryCurrency.trim().toUpperCase()
    : "USD"
  ).slice(0, 3);
  if (salaryCurrency.length !== 3) return jsonError("salaryCurrency must be a 3-letter ISO code");

  let salaryMin: number | null = null;
  let salaryMax: number | null = null;
  if (body.salaryMin !== undefined && body.salaryMin !== null && body.salaryMin !== "") {
    salaryMin = Number(body.salaryMin);
    if (!Number.isFinite(salaryMin) || salaryMin < 0) return jsonError("Invalid salaryMin");
  }
  if (body.salaryMax !== undefined && body.salaryMax !== null && body.salaryMax !== "") {
    salaryMax = Number(body.salaryMax);
    if (!Number.isFinite(salaryMax) || salaryMax < 0) return jsonError("Invalid salaryMax");
  }
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    return jsonError("salaryMin must be <= salaryMax");
  }

  const orgId = getOrgId(session);

  // Sanity-check department / hiring manager belong to this org.
  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: orgId },
      select: { id: true },
    });
    if (!dept) return jsonError("Department not found", 404);
  }
  if (hiringManagerId) {
    const user = await prisma.user.findFirst({
      where: { id: hiringManagerId, organizationId: orgId },
      select: { id: true },
    });
    if (!user) return jsonError("Hiring manager not found", 404);
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const job = await prisma.job.create({
    data: {
      organizationId: orgId,
      workspaceId,
      title,
      description,
      status: "DRAFT",
      employmentType: employmentType as never,
      location,
      departmentId,
      hiringManagerId,
      openings,
      salaryCurrency,
      salaryMin,
      salaryMax,
    },
  });

  logActivity({
    type: "job_created",
    actorId: (session.user as { id: string }).id,
    organizationId: orgId,
    description: `Created job "${title}"`,
    targetId: job.id,
    targetType: "job",
  });

  return jsonSuccess(
    {
      ...job,
      salaryMin: job.salaryMin === null ? null : Number(job.salaryMin),
      salaryMax: job.salaryMax === null ? null : Number(job.salaryMax),
    },
    201,
  );
}
