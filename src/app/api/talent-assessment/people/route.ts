// GET /api/talent-assessment/people?q=&unplacedFor= -> { data, total }
// The people the viewer may place (the Place person picker, and the List
// view's "Not yet placed"): their scope, active, never themself. With
// ?unplacedFor={period} only the people with no placement for that period.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { scopeUserWhere, talentCtx } from "@/lib/performance/talent.server";

export async function GET(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const unplacedFor = (sp.get("unplacedFor") ?? "").trim().slice(0, 100);
  const where = {
    AND: [
      scopeUserWhere(ctx),
      { status: "ACTIVE" as const },
      q ? { OR: [
        { firstName: { contains: q, mode: "insensitive" as const } },
        { lastName: { contains: q, mode: "insensitive" as const } },
        { email: { contains: q, mode: "insensitive" as const } },
      ] } : {},
      unplacedFor ? { NOT: { id: { in: (await prisma.talentAssessment.findMany({ where: { organizationId: ctx.organizationId, period: unplacedFor }, select: { userId: true } })).map((t) => t.userId) } } } : {},
    ],
  };
  const [total, people] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, email: true, avatar: true, managerId: true,
        department: { select: { id: true, name: true } },
        role: { select: { id: true, title: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
    }),
  ]);
  return jsonSuccess({ data: people, total });
}
