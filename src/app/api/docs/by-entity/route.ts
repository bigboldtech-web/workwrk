// /api/docs/by-entity — find-or-create a Doc for a given polymorphic
// entity. Used by the BoardView Doc cell + any module that wants to
// attach a doc without managing its own foreign key.
//
// POST body: { entityType, entityId, title? }
// Returns: { doc }
// If a non-archived Doc already exists for that pair, returns it as-is.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { canCreateDocAt, docAccess } from "@/lib/doc-access";
import { canReadDocPlace, nodeCtxFromLevel } from "@/lib/access/node-access";
import { createRefusal } from "@/lib/access/node-rules";
import { docAnchorPlaceOf, docPlaceLive } from "@/lib/access/node-placement";

const bodySchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1).max(80),
  title: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Gate the parent entity. Without this, find-or-create would let a probe
  // with a guessed parent ID either surface an existing doc on a private
  // parent or mint a new one. 404-not-403 so the gate doesn't leak existence.
  // FINDING the one doc of an entity needs Can view where it lives; MAKING it
  // needs Can edit there (the placement rule, node-rules P1), below.
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const anchor = { entityType: parsed.data.entityType, entityId: parsed.data.entityId };
  const ok = await canReadDocPlace(nodeCtx, anchor, null);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Look for an existing, non-archived doc on this entity.
  const existing = await prisma.doc.findFirst({
    where: {
      organizationId: ctx.orgId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      archivedAt: null,
    },
  });
  if (existing) {
    // An existing doc is handed back only to someone who can open it: a
    // restricted doc on a readable anchor stays closed to the unlisted.
    if (!(await docAccess(nodeCtx, existing.id))) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ doc: existing, created: false });
  }

  if (!(await docPlaceLive(ctx.orgId, { ...anchor, parentId: null }))) {
    const message = "That place is in Trash or gone, so nothing can be added to it.";
    return NextResponse.json({ error: message, code: "conflict", message }, { status: 400 });
  }
  if (!(await canCreateDocAt(nodeCtx, anchor, null))) {
    const message = createRefusal("doc", (await docAnchorPlaceOf(ctx.orgId, anchor)) ?? null);
    return NextResponse.json({ error: message, code: "forbidden", message }, { status: 403 });
  }

  const title = parsed.data.title ?? "Untitled note";
  const content = {};
  const doc = await prisma.doc.create({
    data: {
      organizationId: ctx.orgId,
      title,
      content,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      createdById: ctx.userId,
      versions: { create: { version: 1, title, content, authorId: ctx.userId } },
    },
  });
  return NextResponse.json({ doc, created: true });
}
