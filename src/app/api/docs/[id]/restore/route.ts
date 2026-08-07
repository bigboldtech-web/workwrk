// POST /api/docs/[id]/restore — undo the soft-archive that DELETE /api/docs/[id]
// puts on a doc. Idempotent: restoring an already-live doc is a no-op.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
import { requireDocRole } from "@/lib/doc-sharing";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true, createdById: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Un-archiving is a doc-level mutation — edit-gated.
  const role = await requireDocRole(ctx, { id, createdById: doc.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role === "view") return NextResponse.json({ error: "read-only" }, { status: 403 });
  if (!doc.archivedAt) return NextResponse.json({ ok: true, alreadyLive: true });

  await prisma.doc.update({ where: { id }, data: { archivedAt: null } });
  return NextResponse.json({ ok: true });
}
