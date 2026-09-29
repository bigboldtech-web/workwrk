// GET /api/okrs/[id]/check-ins?page=N: the goal page's Activity card, 12
// check-ins a page, newest first (spec-goals /okrs/[id] body 7). Visibility
// mirrors the goal (canSeeGoal): a goal the viewer cannot see is a 404, so
// its existence never leaks. Reads only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canSeeGoal } from "@/lib/goal-audience";

const PAGE_SIZE = 12;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: orgId }, select: { id: true, level: true, ownerId: true, departmentId: true } });
  if (!okr || !(await canSeeGoal(session, okr))) return jsonError("Not found", 404);

  const raw = new URL(req.url).searchParams.get("page");
  const page = raw && /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
  const where = { keyResult: { okrId: id } };
  const [rows, total] = await Promise.all([
    prisma.kRCheckIn.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, value: true, note: true, createdAt: true, userId: true, keyResult: { select: { id: true, title: true, unit: true } } },
    }),
    prisma.kRCheckIn.count({ where }),
  ]);
  // The value before each check-in (the previous check-in on the same
  // target), so a row reads "30 to 42 units".
  const krIds = [...new Set(rows.map((r) => r.keyResult.id))];
  const earlier = krIds.length
    ? await prisma.kRCheckIn.findMany({
        where: { keyResultId: { in: krIds } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, keyResultId: true, value: true },
      })
    : [];
  const byKr = new Map<string, Array<{ id: string; value: number }>>();
  for (const e of earlier) byKr.set(e.keyResultId, [...(byKr.get(e.keyResultId) ?? []), e]);
  const prevOf = new Map<string, number | null>();
  for (const r of rows) {
    const list = byKr.get(r.keyResult.id) ?? [];
    const i = list.findIndex((x) => x.id === r.id);
    prevOf.set(r.id, i >= 0 && i + 1 < list.length ? list[i + 1].value : null);
  }
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, avatar: true, email: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  return jsonSuccess({
    items: rows.map((r) => ({
      id: r.id,
      value: r.value,
      previous: prevOf.get(r.id) ?? null,
      note: r.note,
      createdAt: r.createdAt,
      target: { id: r.keyResult.id, title: r.keyResult.title, unit: r.keyResult.unit },
      by: userById.get(r.userId) ?? null,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: page * PAGE_SIZE < total,
  });
}
