// GET /api/reviews/[id]/peers?subjectId=&q= -> { data: Candidate[], total, more }
//
// Who to ask for peer feedback on one subject in this cycle
// (spec-teams-performance /reviews/[id] "Ask for peer feedback"). With no
// search: the people who work with them (their department, their office,
// the people who share their manager, their manager and their direct
// reports), each labelled with why. With a search: those that match first,
// then anyone else active in the org by that name ("Elsewhere in the org":
// a Space teammate in another department is found this way), because the
// product always let a runner ask anyone, and a subject with no department,
// office or manager must still be able to get feedback. Never the subject,
// never a removed person.
//
// `total` is the server's count of the people who work with them; the list
// shows the first PAGE and `more` says a search finds the rest.
//
// The same people may call it as may POST the request: the subject's
// reviewer in this cycle, anyone above the subject in the chain, the People
// team and Admin. Anyone else gets 404.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleViewerCtx, peerAllowedWhere, peerCandidateWhere } from "@/lib/performance/review-cycle.server";

const PAGE = 50;

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
  const select = {
    id: true, firstName: true, lastName: true, email: true, avatar: true, managerId: true, departmentId: true, officeId: true,
    role: { select: { title: true } },
  } as const;
  const workWith = { AND: [base, peerAllowedWhere(orgId, s.id)] };
  const [people, total] = await Promise.all([
    prisma.user.findMany({
      where: { AND: [workWith, text] },
      select,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: PAGE,
    }),
    prisma.user.count({ where: workWith }),
  ]);
  const elsewhere = q
    ? await prisma.user.findMany({
        where: { AND: [peerAllowedWhere(orgId, s.id), text, { NOT: base }] },
        select,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: PAGE,
      })
    : [];
  const why = (p: { id: string; managerId: string | null; departmentId: string | null; officeId: string | null }) =>
    p.id === s.managerId ? "Their manager"
      : p.managerId === s.id ? "Reports to them"
        : s.managerId && p.managerId === s.managerId ? "Same manager"
          : s.departmentId && p.departmentId === s.departmentId ? "Same department"
            : "Same office";
  const shape = (p: (typeof people)[number], w: string) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, email: p.email, avatar: p.avatar, jobTitle: p.role?.title ?? null, why: w });
  return jsonSuccess({
    data: [...people.map((p) => shape(p, why(p))), ...elsewhere.map((p) => shape(p, "Elsewhere in the org"))],
    total,
    more: !q && total > people.length,
  });
}
