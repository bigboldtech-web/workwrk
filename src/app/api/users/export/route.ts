// GET /api/users/export: the Directory's Export CSV (spec-teams-people
// /people "..." > Export CSV). Owner and Admin only, never an Agent (the
// export rule, access 9 and invariant 13); the same filters and view as the
// page, every matching row (read in pages, never capped), and one audit row.
// The same people as the page (docs/plans/workspace-status.md D11, step 4):
// someone here through a membership is written with this workspace's
// status and join date, the job title, seniority, department and office
// their membership here holds (D18; the final review, product H1), and no
// phone (security L2: their record here holds no people data).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { logAuditEvent } from "@/lib/activity";
import { parseDirectoryQuery } from "@/lib/people/directory-query";
import { directoryOrder, directorySeats, orderFor, orderedInMemory, prismaWhere } from "@/lib/people/directory-list.server";
import { peopleCtx } from "@/lib/people/person-access.server";
import { resolveUserIdsByTags } from "@/lib/user-tags";
import { toCsv } from "@/lib/people/people-csv";
import { seniorityStoredLabel } from "@/lib/people/seniority";
import { managersWithSeatHere, ownHere, placementsHere } from "@/lib/access/profile-here";

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
  const seats = await directorySeats(ctx, q);
  const where = prismaWhere(ctx, q, tagIds, seats);
  const select = {
    id: true, organizationId: true, firstName: true, lastName: true, email: true, phone: true, joinDate: true, deletedAt: true, status: true,
    // With their workspace: only this workspace's own are written (D18).
    role: { select: { title: true, level: true, organizationId: true } },
    department: { select: { name: true, organizationId: true } },
    office: { select: { name: true, organizationId: true } },
    manager: { select: { id: true, firstName: true, lastName: true, email: true } },
  } as const;
  // In the page's order: in memory when membership people are among the
  // matches and the order is a date or a group here (directoryOrder).
  const ordered = orderedInMemory(q, seats) ? (await directoryOrder(ctx, q, where, seats)).ids : null;
  const lines: unknown[][] = [];
  const PAGE = 1000;
  for (let skip = 0; ; skip += PAGE) {
    let batch: Prisma.UserGetPayload<{ select: typeof select }>[];
    if (ordered) {
      const ids = ordered.slice(skip, skip + PAGE);
      const rows = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select }) : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      batch = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    } else {
      batch = await prisma.user.findMany({ where, orderBy: orderFor(q), skip, take: PAGE, select });
    }
    // A manager only while they hold a seat here (D18, profile-here.ts).
    const managersHere = await managersWithSeatHere(ctx.organizationId, batch.map((u) => u.manager?.id));
    const seatOfRow = (u: (typeof batch)[number]) => (u.organizationId === ctx.organizationId ? undefined : seats.get(u.id));
    // What the memberships in the batch hold here (product H1).
    const placed = await placementsHere(ctx.organizationId, batch.map(seatOfRow).filter((m): m is NonNullable<typeof m> => !!m));
    for (const u of batch) {
      // Their seat here when they work here through a membership (D11): its
      // status, join date and placement here, no phone.
      const m = seatOfRow(u);
      const role = m ? (m.roleId ? placed.role.get(m.roleId) ?? null : null) : ownHere(u.role, ctx.organizationId);
      const department = m ? (m.departmentId ? placed.department.get(m.departmentId) ?? null : null) : ownHere(u.department, ctx.organizationId);
      const office = m ? (m.officeId ? placed.office.get(m.officeId) ?? null : null) : ownHere(u.office, ctx.organizationId);
      const manager = u.manager && managersHere.has(u.manager.id) ? u.manager : null;
      const removed = m ? m.removedAt != null : u.deletedAt != null;
      const status = m ? m.status : String(u.status);
      lines.push([
        u.firstName, u.lastName, u.email, m ? "" : u.phone ?? "",
        role?.title ?? "", role ? seniorityStoredLabel(role.level) : "",
        department?.name ?? "", office?.name ?? "",
        manager ? `${manager.firstName} ${manager.lastName}`.trim() : "", manager?.email ?? "",
        (m ? m.joinedHere : u.joinDate).toISOString().slice(0, 10),
        removed ? "Removed" : status === "INACTIVE" ? "Deactivated" : "Active",
      ]);
    }
    if ((ordered ? Math.min(PAGE, Math.max(0, ordered.length - skip)) : batch.length) < PAGE) break;
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
