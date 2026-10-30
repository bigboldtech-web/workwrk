// GET /api/okrs/[id]/check-ins?page=N: the goal page's Activity card, 12
// check-ins a page, newest first (spec-goals /okrs/[id] body 7). Visibility
// mirrors the goal (canSeeGoal): a goal the viewer cannot see is a 404, so
// its existence never leaks. Reads only.
//
// ?periodKey=<key> (a repeating goal's Activity, This period: docs/plans/
// recurring-goals.md E2): only the check-ins that counted toward that
// period, each "from" the check-in before it in the same period. An unknown
// period is a 404.
//
// THE GOAL'S OWN CHANGES (final review M5): the goal's okr_updated lines
// (a target's number changed for a period, a goal made repeating or stopped,
// a Space counting another number of Lists) come in the same feed, newest
// first, as `kind: "update"` rows beside the `kind: "check-in"` rows, so a
// mid-month cut ("Demos booked: target changed from 60 to 40 for October
// 2026") is on the goal, not only in the workspace log. Every such line is
// written to be read by whoever sees the goal (it never names a List or a
// Space the workspace may not open). This period shows the lines written
// inside that period's dates.

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

  const sp = new URL(req.url).searchParams;
  const raw = sp.get("page");
  const page = raw && /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
  const periodKey = sp.get("periodKey");
  let periodId: string | null = null;
  let window: { gte: Date; lt: Date } | null = null;
  if (periodKey) {
    const p = await prisma.goalPeriod.findUnique({ where: { okrId_key: { okrId: id, key: periodKey } }, select: { id: true, startsAt: true, endsAt: true } });
    if (!p) return jsonError("That period was not found.", 404);
    periodId = p.id;
    window = { gte: p.startsAt, lt: p.endsAt };
  }
  const where = { keyResult: { okrId: id }, ...(periodId ? { periodId } : {}) };
  const updatesWhere = { organizationId: orgId, type: "okr_updated", targetType: "okr", targetId: id, ...(window ? { createdAt: window } : {}) };
  // Two feeds merged newest first: the first page * 12 of each holds every
  // row of the merged page.
  const upTo = page * PAGE_SIZE;
  const [checkIns, checkInTotal, updates, updateTotal] = await Promise.all([
    prisma.kRCheckIn.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: upTo,
      select: { id: true, value: true, note: true, createdAt: true, userId: true, keyResult: { select: { id: true, title: true, unit: true } } },
    }),
    prisma.kRCheckIn.count({ where }),
    prisma.activityLog.findMany({
      where: updatesWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: upTo,
      select: { id: true, description: true, createdAt: true, actorId: true },
    }),
    prisma.activityLog.count({ where: updatesWhere }),
  ]);
  const merged = mergeFeeds(checkIns, updates).slice((page - 1) * PAGE_SIZE, upTo);
  const rows = merged.filter((m): m is { kind: "check-in"; row: (typeof checkIns)[number] } => m.kind === "check-in").map((m) => m.row);
  const total = checkInTotal + updateTotal;
  // The value before each check-in (the previous check-in on the same
  // target), so a row reads "30 to 42 units".
  const krIds = [...new Set(rows.map((r) => r.keyResult.id))];
  const earlier = krIds.length
    ? await prisma.kRCheckIn.findMany({
        where: { keyResultId: { in: krIds }, ...(periodId ? { periodId } : {}) },
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
  const userIds = [...new Set([...rows.map((r) => r.userId), ...merged.flatMap((m) => (m.kind === "update" && m.row.actorId ? [m.row.actorId] : []))])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, avatar: true, email: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  return jsonSuccess({
    items: merged.map((m) => (m.kind === "check-in"
      ? {
          kind: "check-in" as const,
          id: m.row.id,
          value: m.row.value,
          previous: prevOf.get(m.row.id) ?? null,
          note: m.row.note,
          createdAt: m.row.createdAt,
          target: { id: m.row.keyResult.id, title: m.row.keyResult.title, unit: m.row.keyResult.unit },
          by: userById.get(m.row.userId) ?? null,
        }
      : {
          kind: "update" as const,
          id: `u-${m.row.id}`,
          description: m.row.description,
          createdAt: m.row.createdAt,
          by: m.row.actorId ? userById.get(m.row.actorId) ?? null : null,
        })),
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: page * PAGE_SIZE < total,
  });
}

/** The check-ins and the goal's own lines, newest first (ties: the check-in first, then by id). */
function mergeFeeds<C extends { id: string; createdAt: Date }, U extends { id: string; createdAt: Date }>(
  checkIns: readonly C[],
  updates: readonly U[],
): Array<{ kind: "check-in"; row: C } | { kind: "update"; row: U }> {
  const out: Array<{ kind: "check-in"; row: C } | { kind: "update"; row: U }> = [];
  let i = 0;
  let j = 0;
  while (i < checkIns.length || j < updates.length) {
    const c = checkIns[i];
    const u = updates[j];
    if (c && (!u || c.createdAt.getTime() >= u.createdAt.getTime())) {
      out.push({ kind: "check-in", row: c });
      i += 1;
    } else {
      out.push({ kind: "update", row: u });
      j += 1;
    }
  }
  return out;
}
