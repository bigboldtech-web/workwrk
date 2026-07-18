// GET /api/whiteboards/[id] — load scene
// PATCH /api/whiteboards/[id] — save scene (autosaved every few seconds
//   by the canvas page) + rename / update description / thumbnail
// DELETE /api/whiteboards/[id] — soft-archive

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { getSpaceForReader } from "@/lib/space";
import { recordSnapshot } from "@/lib/snapshots";

async function checkSpaceVisible(spaceId: string | null, userId: string, accessLevel: string | null | undefined): Promise<boolean> {
  if (!spaceId) return true;
  const space = await getSpaceForReader(spaceId, userId, accessLevel ?? "EMPLOYEE");
  return Boolean(space);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const whiteboard = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!whiteboard) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await checkSpaceVisible(whiteboard.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ whiteboard });
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  // Scene is opaque to us — Excalidraw owns the shape. Use unknown
  // for the value type and trust the client to send valid scene.
  scene: z.unknown().optional(),
  thumbnail: z.string().max(2_000_000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const existing = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await checkSpaceVisible(existing.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const whiteboard = await prisma.whiteboard.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.scene !== undefined ? { scene: parsed.data.scene as object } : {}),
      ...(parsed.data.thumbnail !== undefined ? { thumbnail: parsed.data.thumbnail } : {}),
      lastEditedById: ctx.userId,
      lastEditedAt: new Date(),
    },
    select: { id: true, name: true, updatedAt: true, lastEditedAt: true },
  });

  // Version history — snapshot the scene after a successful save (best-effort,
  // throttled, never affects the save above).
  if (parsed.data.scene !== undefined) {
    await recordSnapshot("WHITEBOARD", id, ctx.orgId, parsed.data.scene, ctx.userId);
  }

  return NextResponse.json({ whiteboard });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const existing = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await checkSpaceVisible(existing.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.whiteboard.update({ where: { id }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
