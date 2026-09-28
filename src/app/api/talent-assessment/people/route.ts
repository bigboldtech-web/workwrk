// GET /api/talent-assessment/people?q=&unplacedFor=&cursor= -> { data, total, nextCursor }
// Paged by cursor (PAGE at a time, `total` the server's count), never a
// silent cap: a caller that needs everyone follows nextCursor.
// The people the viewer may place (the Place person picker, and the List
// view's "Not yet placed"): their scope, active, never themself. With
// ?unplacedFor={period} only the people with no placement for that period.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { scopeUserWhere, talentCtx } from "@/lib/performance/talent.server";

const PAGE = 200;

export async function GET(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const unplacedFor = (sp.get("unplacedFor") ?? "").trim().slice(0, 100);
  const cursor = (sp.get("cursor") ?? "").trim() || null;
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
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  ]);
  const more = people.length > PAGE;
  const page = more ? people.slice(0, PAGE) : people;
  return jsonSuccess({ data: page, total, nextCursor: more ? page[page.length - 1].id : null });
}
