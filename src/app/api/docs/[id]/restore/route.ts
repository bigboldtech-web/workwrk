// POST /api/docs/[id]/restore — undo the soft-archive that DELETE /api/docs/[id]
// puts on a doc. Idempotent: restoring an already-live doc is a no-op.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { canCreateDocAt, docAccessible } from "@/lib/doc-access";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { docPlaceLive } from "@/lib/access/node-placement";
import { requireDocRole } from "@/lib/doc-sharing";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true, parentId: true, createdById: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Un-archiving is a doc-level mutation — edit-gated.
  const role = await requireDocRole(ctx, { id, createdById: doc.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role === "view") {
    // P6: one plain sentence naming what is needed (it answered "read-only").
    const message = "You need Can edit on this doc to restore it.";
    return NextResponse.json({ error: message, code: "forbidden", message }, { status: 403 });
  }
  if (!doc.archivedAt) return NextResponse.json({ ok: true, alreadyLive: true });

  // Restoring puts the doc back INTO its place, so the placement rule holds
  // (node-rules P1 and P3): the place must still be there and live (not a
  // Folder in Trash, an archived List, a page gone), and the person must
  // still be able to add docs there. A grant revoked since the doc was
  // archived never brings it back.
  const place = { entityType: doc.entityType, entityId: doc.entityId, parentId: doc.parentId };
  if (!(await docPlaceLive(ctx.orgId, place))) {
    const message = "The place this doc lived in is gone or in Trash, so it can't come back there.";
    return NextResponse.json({ error: message, code: "conflict", message }, { status: 409 });
  }
  if (!(await canCreateDocAt(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), { entityType: doc.entityType, entityId: doc.entityId }, doc.parentId))) {
    const message = "You need Can edit where this doc lived to bring it back there.";
    return NextResponse.json({ error: message, code: "forbidden", message }, { status: 403 });
  }

  await prisma.doc.update({ where: { id }, data: { archivedAt: null } });
  return NextResponse.json({ ok: true });
}
