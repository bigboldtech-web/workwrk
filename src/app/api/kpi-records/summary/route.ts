// GET /api/kpi-records/summary?period=YYYY-MM[&userIds=a,b]: the KPI reviews
// people list (spec-goals /team/kpi-reviews). For every person the viewer
// acts on (their chain, solid or dotted; the org for the People team and
// Admin; src/lib/kpi-review.server.ts), the month's counts:
//   { userId, pending, submitted, approved, rejected, total } plus the
//   person's name, avatar, job title and department for the people list
// `total` is the KPIs the person carries through their ACTIVE KRA
// assignments, so "not recorded" counts KPIs with no row at all. Computed
// server-side for everyone, so a person's chip is right before they are
// opened. Never includes the viewer. Reads only.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveKpiPeriod } from "@/lib/kpi-period";
import { kpiActorCtx, mayActOnKpisOf } from "@/lib/kpi-review.server";
import { teamScopeFor } from "@/lib/people/team-scope.server";

export async function GET(req: NextRequest) {
  const ctx = await kpiActorCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.orgRole === "GUEST") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const period = resolveKpiPeriod(sp.get("period"));
  const asked = (sp.get("userIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const scope = await teamScopeFor(ctx);
  const pool = asked.length ? asked.filter((id) => scope.ids.includes(id)) : scope.ids;
  const ids = pool.filter((id) => id !== ctx.userId && mayActOnKpisOf(ctx, id));
  if (ids.length === 0) return NextResponse.json({ period, people: [] });

  const [assignments, records, users] = await Promise.all([
    prisma.kRAAssignment.findMany({
      where: { userId: { in: ids }, status: "ACTIVE", kra: { organizationId: ctx.organizationId } },
      select: { userId: true, kra: { select: { kpis: { select: { id: true } } } } },
    }),
    prisma.kPIRecord.findMany({
      where: { userId: { in: ids }, period, kpi: { organizationId: ctx.organizationId } },
      select: { userId: true, kpiId: true, status: true },
    }),
    prisma.user.findMany({
      where: { id: { in: ids }, organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true, role: { select: { title: true } }, department: { select: { id: true, name: true } } },
    }),
  ]);
  const userById = new Map(users.map((x) => [x.id, x]));
  const kpisOf = new Map<string, Set<string>>();
  for (const a of assignments) {
    const s = kpisOf.get(a.userId) ?? new Set<string>();
    for (const k of a.kra.kpis) s.add(k.id);
    kpisOf.set(a.userId, s);
  }
  const people = ids.map((userId) => {
    const kpis = kpisOf.get(userId) ?? new Set<string>();
    const mine = records.filter((r) => r.userId === userId && kpis.has(r.kpiId));
    const u = userById.get(userId);
    const c = {
      userId,
      firstName: u?.firstName ?? "",
      lastName: u?.lastName ?? "",
      email: u?.email ?? "",
      avatar: u?.avatar ?? null,
      jobTitle: u?.role?.title ?? null,
      department: u?.department ?? null,
      pending: 0, submitted: 0, approved: 0, rejected: 0, total: kpis.size,
    };
    for (const r of mine) {
      if (r.status === "SUBMITTED") c.submitted += 1;
      else if (r.status === "APPROVED") c.approved += 1;
      else if (r.status === "REJECTED") c.rejected += 1;
      else c.pending += 1;
    }
    // KPIs with no row this month are not recorded either.
    c.pending += Math.max(0, kpis.size - mine.length);
    return c;
  });
  return NextResponse.json({ period, people: people.filter((p) => userById.has(p.userId)), direct: [...scope.direct].filter((id) => ids.includes(id)) });
}
