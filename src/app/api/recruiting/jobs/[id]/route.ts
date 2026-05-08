// Job detail / edit / status transitions / delete. Status transitions
// stamp publishedAt and closedAt for audit; OPEN ↔ ON_HOLD allowed,
// CLOSED / FILLED are terminal but admin can reopen via DRAFT.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

const VALID_STATUS = new Set(["DRAFT", "OPEN", "ON_HOLD", "CLOSED", "FILLED"]);
const VALID_TYPE = new Set(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const job = await prisma.job.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: { select: { id: true, name: true } },
      hiringManager: { select: { id: true, firstName: true, lastName: true, email: true } },
      _count: { select: { applications: true } },
    },
  });
  if (!job) return jsonError("Job not found", 404);

  return jsonSuccess({
    ...job,
    salaryMin: job.salaryMin === null ? null : Number(job.salaryMin),
    salaryMax: job.salaryMax === null ? null : Number(job.salaryMax),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = (session.user as { id: string }).id;

  const job = await prisma.job.findFirst({ where: { id, organizationId: orgId } });
  if (!job) return jsonError("Job not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t) return jsonError("title cannot be empty");
    if (t.length > 200) return jsonError("title too long");
    data.title = t;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.location !== undefined) {
    data.location = typeof body.location === "string" ? body.location.trim() || null : null;
  }
  if (typeof body.employmentType === "string") {
    if (!VALID_TYPE.has(body.employmentType)) return jsonError("Invalid employmentType");
    data.employmentType = body.employmentType;
  }
  if (body.openings !== undefined) {
    const num = Number(body.openings);
    if (!Number.isFinite(num) || num < 1 || num > 10_000) return jsonError("Invalid openings");
    data.openings = num;
  }
  if (body.departmentId !== undefined) {
    if (body.departmentId === null || body.departmentId === "") {
      data.departmentId = null;
    } else {
      const dept = await prisma.department.findFirst({
        where: { id: body.departmentId, organizationId: orgId },
        select: { id: true },
      });
      if (!dept) return jsonError("Department not found", 404);
      data.departmentId = body.departmentId;
    }
  }
  if (body.hiringManagerId !== undefined) {
    if (body.hiringManagerId === null || body.hiringManagerId === "") {
      data.hiringManagerId = null;
    } else {
      const user = await prisma.user.findFirst({
        where: { id: body.hiringManagerId, organizationId: orgId },
        select: { id: true },
      });
      if (!user) return jsonError("Hiring manager not found", 404);
      data.hiringManagerId = body.hiringManagerId;
    }
  }
  if (body.salaryMin !== undefined) {
    if (body.salaryMin === null || body.salaryMin === "") {
      data.salaryMin = null;
    } else {
      const num = Number(body.salaryMin);
      if (!Number.isFinite(num) || num < 0) return jsonError("Invalid salaryMin");
      data.salaryMin = num;
    }
  }
  if (body.salaryMax !== undefined) {
    if (body.salaryMax === null || body.salaryMax === "") {
      data.salaryMax = null;
    } else {
      const num = Number(body.salaryMax);
      if (!Number.isFinite(num) || num < 0) return jsonError("Invalid salaryMax");
      data.salaryMax = num;
    }
  }
  if (typeof body.salaryCurrency === "string") {
    const cur = body.salaryCurrency.trim().toUpperCase();
    if (cur.length !== 3) return jsonError("salaryCurrency must be 3-letter ISO");
    data.salaryCurrency = cur;
  }
  if (typeof body.status === "string") {
    if (!VALID_STATUS.has(body.status)) return jsonError("Invalid status");
    data.status = body.status;
    if (body.status === "OPEN" && !job.publishedAt) data.publishedAt = new Date();
    if ((body.status === "CLOSED" || body.status === "FILLED") && !job.closedAt) {
      data.closedAt = new Date();
    }
    if (body.status === "DRAFT") data.closedAt = null;
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.job.update({ where: { id }, data });

  logActivity({
    type: "job_updated",
    actorId: userId,
    organizationId: orgId,
    description: `Updated job "${updated.title}"`,
    targetId: id,
    targetType: "job",
  });

  return jsonSuccess({
    ...updated,
    salaryMin: updated.salaryMin === null ? null : Number(updated.salaryMin),
    salaryMax: updated.salaryMax === null ? null : Number(updated.salaryMax),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const job = await prisma.job.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { applications: true } } },
  });
  if (!job) return jsonError("Job not found", 404);
  if (job._count.applications > 0) {
    return jsonError("Job has applications. Close instead of deleting.", 409);
  }

  await prisma.job.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
