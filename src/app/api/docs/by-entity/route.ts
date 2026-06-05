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
import { docAccessible } from "@/lib/doc-access";

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

  // Phase 37 — gate the parent entity. Without this, find-or-create
  // would let a probe with a guessed parent ID either surface an
  // existing doc on a private parent or mint a new one. 404-not-403
  // so the gate doesn't leak existence.
  const ok = await docAccessible(parsed.data, ctx.userId, ctx.accessLevel);
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
  if (existing) return NextResponse.json({ doc: existing, created: false });

  const title = parsed.data.title ?? "Untitled doc";
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
