// GET /api/whiteboards/[id] — load scene
// PATCH /api/whiteboards/[id] — save scene (autosaved every few seconds
//   by the canvas page) + rename / update description / thumbnail
// DELETE /api/whiteboards/[id] — soft-archive

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { whiteboardReadable } from "@/lib/whiteboard-gate";
import { recordSnapshot } from "@/lib/snapshots";
import { withArchivedBy } from "@/lib/archived-by";
import { legacyFloorRole, nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { moveCanvas } from "@/lib/access/node-placement";
import { roleAtLeast } from "@/lib/access/node-rules";

// The read gate (whiteboardReadable) lives in src/lib/whiteboard-gate.ts, so
// the Work canvas routes gate with the same function as these three verbs:
// the viewer's role on the canvas from the one resolver (its Folder when that
// Folder is in its Space, else its Space, else the org; its owner with reach;
// a canvas grant).

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const whiteboard = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!whiteboard) return NextResponse.json({ error: "not found" }, { status: 404 });
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const role = await whiteboardReadable(nodeCtx, whiteboard);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The viewer's role on this canvas, for the editor's read-only mode and the
  // role chip (spec-docs-knowledge section 2, /canvas/[id]). `canManage` and
  // `canShare` are Full access on the canvas: the canvas's own Manage access
  // dialog (a canvas grant), never a Space membership. `spaceManage` still
  // says whether the viewer manages the canvas's Space.
  const space = whiteboard.spaceId ? await nodeRole(nodeCtx, { kind: "space", id: whiteboard.spaceId }) : null;
  const myRole: "full" | "edit" | "view" = roleAtLeast(role, "FULL") ? "full" : roleAtLeast(role, "EDIT") ? "edit" : "view";
  const full = roleAtLeast(role, "FULL");

  return NextResponse.json({
    whiteboard,
    myRole,
    canManage: full,
    canShare: full,
    spaceManage: nodeCtx.orgAdmin || (!!space && roleAtLeast(space.role, "FULL")),
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  // Scene is opaque to us — Excalidraw owns the shape. Use unknown
  // for the value type and trust the client to send valid scene.
  scene: z.unknown().optional(),
  thumbnail: z.string().max(2_000_000).optional(),
  // Move to a Space's root, or out of every Space (null). Validated below.
  spaceId: z.string().min(1).nullable().optional(),
  // Move into a Folder: its Space is the canvas's Space (the placement rule,
  // node-rules P3), and a spaceId that disagrees is refused.
  folderId: z.string().min(1).nullable().optional(),
  // Conflict-detection precondition (spec-docs-knowledge section 2,
  // /canvas/[id] Data): the updatedAt the client last observed. When it is
  // provided and stale, the save answers 409 { liveUpdatedAt } instead of
  // silently overwriting a peer's scene (the same rule PUT /api/docs/[id]
  // applies). Absent = the old last-write-wins, so no existing caller changes.
  expectedUpdatedAt: z.string().datetime().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const existing = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const role = await whiteboardReadable(nodeCtx, existing);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Content needs Can edit on the canvas: a Can view holder gets the one 403
  // the editor already renders as read-only (the backstop for a stale tab).
  const contentChange = parsed.data.name !== undefined || parsed.data.description !== undefined || parsed.data.scene !== undefined || parsed.data.thumbnail !== undefined;
  if (contentChange && !roleAtLeast(role, "EDIT")) {
    return NextResponse.json({ error: "read-only", message: "You can view this canvas but not edit it." }, { status: 403 });
  }

  if (parsed.data.expectedUpdatedAt && parsed.data.scene !== undefined) {
    const observedMs = new Date(parsed.data.expectedUpdatedAt).getTime();
    const liveMs = existing.updatedAt.getTime();
    if (observedMs < liveMs) {
      return NextResponse.json(
        { error: "conflict", message: "This canvas was edited elsewhere. Reload to see the latest version before saving again.", liveUpdatedAt: existing.updatedAt },
        { status: 409 },
      );
    }
  }

  // A move is the placement rule's (node-rules P2 and P3), through its one
  // helper: Full access on the canvas (never from a canvas grant alone, M3)
  // and on the place it leaves (and its Space when it leaves the Space), Can
  // edit where it goes (the org's, for out of every Space), and the Space
  // taken from the Folder it goes into. Moving to another Space's root
  // clears the Folder it had: a canvas never keeps a Folder of the Space it
  // left. The move is written before the rest, and a refused one writes
  // nothing at all.
  if (parsed.data.spaceId !== undefined || parsed.data.folderId !== undefined) {
    const moved = await moveCanvas(nodeCtx, id, {
      spaceId: parsed.data.folderId ? parsed.data.spaceId ?? null : parsed.data.spaceId !== undefined ? parsed.data.spaceId : existing.spaceId,
      folderId: parsed.data.folderId ?? null,
    });
    if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: moved.status });
  }

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
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const role = await whiteboardReadable(nodeCtx, existing);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Moving a canvas to the Trash is an edit under the one model. Before it,
  // any reader of the canvas's Space could trash it (a Space guest included),
  // and that reach is kept for the rows that gave it (A8): the legacy floor
  // answers today's reader, and never for a grant made by this release.
  if (!roleAtLeast(role, "EDIT") && !roleAtLeast(await legacyFloorRole(nodeCtx, { kind: "canvas", id }), "VIEW")) {
    return NextResponse.json({ error: "read-only", message: "You can view this canvas but not delete it." }, { status: 403 });
  }

  await withArchivedBy(ctx.userId, (extra) =>
    prisma.whiteboard.update({ where: { id }, data: { archivedAt: new Date(), ...extra } }),
  );
  return NextResponse.json({ ok: true });
}
