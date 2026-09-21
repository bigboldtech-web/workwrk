// POST /api/docs/[id]/lock { locked: boolean } -> { lockedById, lockedAt }
//
// "Lock page" (spec-docs-knowledge change request A4): a per-doc modifier
// like Restricted. While `Doc.lockedById` is set, everyone below Full access
// resolves to Can comment on that doc (content read-only, comments on);
// setting and clearing it needs Full access. Before this the lock was a
// boolean inside the doc's own content JSON that any editor could flip and
// the server never read, so it changed nothing about who could save.
//
// Tolerates the columns being absent for one release the way
// src/lib/archived-by.ts does for archivedById: the write fails closed with a
// 503 that names the migration rather than a bare 500.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
import { isDocFull, requireDocRole } from "@/lib/doc-sharing";
import { readDocLock, writeDocLock } from "@/lib/doc-lock";

const schema = z.object({ locked: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, createdById: true, entityType: true, entityId: true, archivedAt: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const role = await requireDocRole(ctx, { id, createdById: doc.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });
  if (!isDocFull(ctx, { createdById: doc.createdById })) {
    return NextResponse.json({ error: "forbidden", message: "You need Full access to lock or unlock this doc." }, { status: 403 });
  }

  const ok = await writeDocLock(id, parsed.data.locked ? ctx.userId : null);
  if (!ok) {
    return NextResponse.json(
      { error: "unavailable", message: "Lock page needs the 2026-09-21-doc-lock migration applied." },
      { status: 503 },
    );
  }
  const row = await readDocLock(id);
  return NextResponse.json({ lockedById: row?.lockedById ?? null, lockedAt: row?.lockedAt ?? null });
}
