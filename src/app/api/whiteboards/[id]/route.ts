// GET /api/whiteboards/[id] — load scene
// PATCH /api/whiteboards/[id] — save scene (autosaved every few seconds
//   by the canvas page) + rename / update description / thumbnail
// DELETE /api/whiteboards/[id] — soft-archive

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { canContributeSpace, canEditSpace, getSpaceForReader, isOrgAdminAccessLevel } from "@/lib/space";
import { recordSnapshot } from "@/lib/snapshots";
import { withArchivedBy } from "@/lib/archived-by";

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

  // The viewer's role on this canvas, for the editor's read-only mode and the
  // role chip (spec-docs-knowledge section 2, /canvas/[id]). A canvas has no
  // grant rows of its own yet, so the role is the anchor's: on a Space,
  // Can edit for anyone who can CONTRIBUTE to it and Can view for a Space
  // guest; standalone canvases are org-wide and everyone edits. Full access =
  // the owner or an org admin. `spaceManage` says whether the viewer manages
  // the Space, which is where the Share door for an anchored canvas opens.
  const admin = isOrgAdminAccessLevel(ctx.accessLevel);
  const owner = whiteboard.ownerId === ctx.userId;
  const [contributes, spaceManage] = whiteboard.spaceId
    ? await Promise.all([
        canContributeSpace(whiteboard.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"),
        canEditSpace(whiteboard.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"),
      ])
    : [true, false];
  const myRole: "full" | "edit" | "view" = admin || owner ? "full" : contributes ? "edit" : "view";

  return NextResponse.json({ whiteboard, myRole, spaceManage: admin || spaceManage });
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  // Scene is opaque to us — Excalidraw owns the shape. Use unknown
  // for the value type and trust the client to send valid scene.
  scene: z.unknown().optional(),
  thumbnail: z.string().max(2_000_000).optional(),
  // Move to a Space, or out of one (null). Validated below.
  spaceId: z.string().min(1).nullable().optional(),
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
  if (!(await checkSpaceVisible(existing.spaceId, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // A Space guest reads the Space and cannot contribute to it, so the canvas
  // is view-only for them: the editor renders no tools, and this is the
  // backstop for a stale tab. Same shape as the docs 403 ("read-only").
  if (existing.spaceId && !isOrgAdminAccessLevel(ctx.accessLevel) && existing.ownerId !== ctx.userId) {
    if (!(await canContributeSpace(existing.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"))) {
      return NextResponse.json({ error: "read-only", message: "You can view this canvas but not edit it." }, { status: 403 });
    }
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

  // A Space move needs edit on the destination (and read on the source, which
  // the visibility check above already gave).
  if (parsed.data.spaceId !== undefined && parsed.data.spaceId !== null) {
    if (!(await canEditSpace(parsed.data.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"))) {
      return NextResponse.json({ error: "You need edit access to that Space." }, { status: 403 });
    }
  }

  const whiteboard = await prisma.whiteboard.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.spaceId !== undefined ? { spaceId: parsed.data.spaceId, ...(parsed.data.spaceId === null ? { folderId: null } : {}) } : {}),
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

  await withArchivedBy(ctx.userId, (extra) =>
    prisma.whiteboard.update({ where: { id }, data: { archivedAt: new Date(), ...extra } }),
  );
  return NextResponse.json({ ok: true });
}
