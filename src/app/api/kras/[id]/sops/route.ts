// POST /api/kras/[id]/sops { sopId }: Link SOP on the Job title page
// (spec-teams-people /people/roles/[id], PO-1.11 "no add path"). Links a
// PUBLISHED SOP to one of the title's KRAs by setting SOP.kraId. The job
// title writers (Owner, Admin, People team, and the tier that could write
// titles yesterday) link; an SOP already linked to a different KRA moves
// only when the caller says so (`move: true`), so nothing is pulled off
// another title silently. DELETE { sopId } unlinks.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mayWriteJobTitles } from "@/lib/people/job-title-access.server";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

async function guard(kraId: string) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { organizationId?: string } | undefined;
  if (!u?.organizationId) return { res: err(401, "Unauthorized") } as const;
  if (!(await mayWriteJobTitles(session))) return { res: err(403, "Only the people who manage job titles link SOPs.") } as const;
  const kra = await prisma.kRA.findFirst({ where: { id: kraId, organizationId: u.organizationId }, select: { id: true, name: true } });
  if (!kra) return { res: err(404, "Not found") } as const;
  return { orgId: u.organizationId, kra } as const;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => null)) as { sopId?: unknown; move?: unknown } | null;
  const sopId = typeof body?.sopId === "string" ? body.sopId : "";
  if (!sopId) return err(400, "sopId is required");
  const sop = await prisma.sOP.findFirst({
    where: { id: sopId, organizationId: g.orgId },
    select: { id: true, title: true, status: true, kraId: true, kra: { select: { name: true } } },
  });
  if (!sop) return err(404, "SOP not found");
  if (sop.status !== "PUBLISHED") return err(400, "Only a published SOP can be linked");
  if (sop.kraId === id) return NextResponse.json({ ok: true, sopId, kraId: id, unchanged: true });
  if (sop.kraId && body?.move !== true) {
    return err(409, `"${sop.title}" is linked to ${sop.kra?.name ?? "another KRA"}. Move it here?`, { code: "linked_elsewhere", currentKra: sop.kra?.name ?? null });
  }
  await prisma.sOP.update({ where: { id: sopId }, data: { kraId: id } });
  return NextResponse.json({ ok: true, sopId, kraId: id });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const sopId = new URL(req.url).searchParams.get("sopId") ?? "";
  const r = await prisma.sOP.updateMany({ where: { id: sopId, organizationId: g.orgId, kraId: id }, data: { kraId: null } });
  if (r.count === 0) return err(404, "Not found");
  return NextResponse.json({ ok: true });
}
