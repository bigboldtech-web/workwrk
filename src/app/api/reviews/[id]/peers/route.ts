// GET /api/reviews/[id]/peers?subjectId=&q= -> { data: Candidate[] }
//
// Who may be asked for peer feedback on one subject in this cycle
// (spec-teams-performance /reviews/[id] "Ask for peer feedback"): people
// who actually work with them, never the whole org. That is: their
// department, their office, the people who share their manager, their
// manager and their direct reports. Never the subject,
// never a removed person, never a Guest.
//
// The same people may call it as may POST the request: the subject's
// reviewer in this cycle, anyone above the subject in the chain, the People
// team and Admin. Anyone else gets 404.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleViewerCtx, peerCandidateWhere } from "@/lib/performance/review-cycle.server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await cycleViewerCtx();
  if (!ctx || ctx.isGuest) return jsonError("Not found", 404);
  const { id } = await params;
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const subjectId = sp.get("subjectId") ?? "";
  const q = (sp.get("q") ?? "").trim().slice(0, 100);

  const review = await prisma.review.findFirst({
    where: { cycleId: id, subjectId, cycle: { organizationId: orgId } },
    select: { reviewerId: true, subject: { select: { id: true, managerId: true, departmentId: true, officeId: true } } },
  });
  if (!review) return jsonError("Not found", 404);
  const allowed = ctx.peopleTeamOrAdmin || review.reviewerId === ctx.userId || ctx.chain.has(subjectId);
  if (!allowed) return jsonError("Not found", 404);

  const s = review.subject;
  const base = await peerCandidateWhere(orgId, s);
  const text = q
    ? { OR: [
        { firstName: { contains: q, mode: "insensitive" as const } },
        { lastName: { contains: q, mode: "insensitive" as const } },
        { email: { contains: q, mode: "insensitive" as const } },
      ] }
    : {};
  const people = await prisma.user.findMany({
    where: { AND: [base, text] },
    select: {
      id: true, firstName: true, lastName: true, email: true, avatar: true, managerId: true, departmentId: true,
      role: { select: { title: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 50,
  });
  const why = (p: { id: string; managerId: string | null; departmentId: string | null }) =>
    p.id === s.managerId ? "Their manager"
      : p.managerId === s.id ? "Reports to them"
        : s.managerId && p.managerId === s.managerId ? "Same manager"
          : s.departmentId && p.departmentId === s.departmentId ? "Same department"
            : "Same office";
  return jsonSuccess({
    data: people.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, email: p.email, avatar: p.avatar, jobTitle: p.role?.title ?? null, why: why(p) })),
  });
}
