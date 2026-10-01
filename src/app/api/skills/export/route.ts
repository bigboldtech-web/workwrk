// GET /api/skills/export: the Skills page's Export CSV, Owner and Admin only
// (never an Agent), one row per person and skill, with an audit row.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { peopleCtx } from "@/lib/people/person-access.server";
import { toCsv } from "@/lib/people/people-csv";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.orgRole === "GUEST") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!ctx.isAdmin || ctx.isAgent) return NextResponse.json({ error: "Only an Admin can export skills." }, { status: 403 });
  const rows = await prisma.userSkill.findMany({
    where: { user: { organizationId: ctx.organizationId, deletedAt: null } },
    orderBy: [{ name: "asc" }],
    select: {
      name: true, selfRating: true, managerRating: true,
      user: { select: { firstName: true, lastName: true, email: true, department: { select: { name: true } } } },
    },
  });
  const csv = toCsv(
    ["Skill", "First name", "Last name", "Email", "Department", "Self rating", "Manager rating"],
    rows.map((r) => [r.name, r.user.firstName, r.user.lastName, r.user.email, r.user.department?.name ?? "", r.selfRating || "", r.managerRating ?? ""]),
  );
  void logAuditEvent({
    type: "data.exported",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Exported ${rows.length} skill ${rows.length === 1 ? "row" : "rows"}`,
    targetType: "Skills",
    metadata: { rows: rows.length },
  });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skills-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
