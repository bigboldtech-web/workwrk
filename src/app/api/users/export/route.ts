// GET /api/users/export: the Directory's Export CSV (spec-teams-people
// /people "..." > Export CSV). Owner and Admin only, never an Agent (the
// export rule, access 9 and invariant 13); the same filters and view as the
// page, every matching row (read in pages, never capped), and one audit row.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { parseDirectoryQuery } from "@/lib/people/directory-query";
import { orderFor, prismaWhere } from "@/lib/people/directory-list.server";
import { peopleCtx } from "@/lib/people/person-access.server";
import { resolveUserIdsByTags } from "@/lib/user-tags";
import { toCsv } from "@/lib/people/people-csv";
import { seniorityLabel } from "@/lib/people/seniority";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.orgRole === "GUEST") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!ctx.isAdmin || ctx.isAgent) return NextResponse.json({ error: "Only an Admin can export the directory." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const q = parseDirectoryQuery(sp, { privileged: true });
  // ?ids= is the bulk bar's Export selected: the selection, within the filters.
  const picked = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5000);
  let tagIds = q.tagIds.length ? await resolveUserIdsByTags(ctx.organizationId, q.tagIds) : null;
  if (picked.length) tagIds = tagIds ? tagIds.filter((id) => picked.includes(id)) : picked;
  const where = prismaWhere(ctx, q, tagIds);
  const lines: unknown[][] = [];
  const PAGE = 1000;
  for (let skip = 0; ; skip += PAGE) {
    const batch = await prisma.user.findMany({
      where,
      orderBy: orderFor(q),
      skip,
      take: PAGE,
      select: {
        firstName: true, lastName: true, email: true, phone: true, joinDate: true, deletedAt: true, status: true,
        role: { select: { title: true, level: true } },
        department: { select: { name: true } },
        office: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    for (const u of batch) {
      lines.push([
        u.firstName, u.lastName, u.email, u.phone ?? "",
        u.role?.title ?? "", u.role ? seniorityLabel(u.role.level) : "",
        u.department?.name ?? "", u.office?.name ?? "",
        u.manager ? `${u.manager.firstName} ${u.manager.lastName}`.trim() : "", u.manager?.email ?? "",
        u.joinDate.toISOString().slice(0, 10),
        u.deletedAt ? "Removed" : u.status === "INACTIVE" ? "Deactivated" : "Active",
      ]);
    }
    if (batch.length < PAGE) break;
  }
  const csv = toCsv(
    ["First name", "Last name", "Email", "Phone", "Job title", "Seniority", "Department", "Office", "Reports to", "Reports to email", "Joined", "Status"],
    lines,
  );
  void logAuditEvent({
    type: "data.exported",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Exported ${lines.length} people from the Directory`,
    targetType: "Directory",
    metadata: { rows: lines.length, view: q.view },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="directory-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
