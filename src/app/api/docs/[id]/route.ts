// /api/docs/[id] — load, save, soft-archive a Doc.
//
// Critical guarantees:
//   - Every save creates a new immutable DocVersion. No save is silent.
//   - DELETE is soft-archive only (sets archivedAt). The row stays.
//   - Versions are NEVER touched on archive — full history persists.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { canCreateDocAt, docAccess, docAccessible } from "@/lib/doc-access";
import { requireDocRole } from "@/lib/doc-sharing";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { moveDestinations } from "@/lib/access/node-placement";
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";
import { withArchivedBy } from "@/lib/archived-by";
import { resolveDocLocation } from "@/lib/doc-location";
import { readDocLock } from "@/lib/doc-lock";
import { saveDocAs, type TreeRow } from "@/lib/docs/doc-save";

/**
 * The parent page the crumb and the Back link name, ONLY when this viewer can
 * read it through the SAME gate the parent's own GET applies (docAccess, the
 * one resolver). A sub-page follows its parent (A6), but it can carry a grant
 * of its own, so it can be readable while its parent is not; naming the
 * parent then would hand its title to someone its own URL answers 404.
 * Unreadable is null, exactly like a doc with no parent, so the page falls
 * back to the anchor.
 */
async function readableParent(
  ctx: { orgId: string; userId: string; accessLevel: string | null | undefined },
  parentId: string,
): Promise<{ id: string; title: string } | null> {
  const p = await prisma.doc.findFirst({
    where: { id: parentId, organizationId: ctx.orgId },
    select: { id: true, title: true },
  });
  if (!p) return null;
  if (!(await docAccess(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), p.id))) return null;
  return { id: p.id, title: p.title };
}

type MenuSpace = { id: string; name: string; slug: string; icon: string | null; color: string | null };

/**
 * GET ?menu=1: what the doc's row menu may offer, from the rules the writes
 * apply, so it never shows a control that can only fail (a Can edit grant on
 * one doc was offered Duplicate, "No location" and every Space, and each was
 * refused). Duplicate asks canCreateDocAt for the place the copy lands,
 * exactly as POST /duplicate does. A move is the placement rule's: Full
 * access on the doc (a notepad note never re-anchors), and the places
 * moveDestinations accepts, "No location" and each Space's root.
 */
async function menuCaps(
  ctx: { orgId: string; userId: string; accessLevel: string | null | undefined },
  doc: TreeRow & { id: string; archivedAt: Date | null },
  access: { unlockedRole: Parameters<typeof roleAtLeast>[0]; canManage: boolean; locked: boolean },
): Promise<{ canDuplicate: boolean; move: { none: boolean; spaces: MenuSpace[] } }> {
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const nothing = { none: false, spaces: [] as MenuSpace[] };
  if (doc.archivedAt) return { canDuplicate: false, move: nothing };
  const anchor = doc.entityType && doc.entityId ? { entityType: doc.entityType, entityId: doc.entityId } : null;
  const canDuplicate = await canCreateDocAt(nodeCtx, anchor, doc.parentId);
  if (!access.canManage || doc.entityType === "NOTEPAD") return { canDuplicate, move: nothing };
  const dests = await moveDestinations(nodeCtx, { kind: "doc", id: doc.id });
  if (!dests) return { canDuplicate, move: nothing };
  return {
    canDuplicate,
    move: {
      none: dests.root?.pickable === true,
      spaces: dests.spaces.filter((s) => s.pickable).map((s) => ({ id: s.id, name: s.name, slug: s.slug, icon: s.icon, color: s.color })),
    },
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 50,
        select: { id: true, version: true, title: true, authorId: true, createdAt: true },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The one resolver: anchor, parent page, listings, restricted, the note
  // rule and the page lock, in one world. No role is the same 404 as an
  // invisible anchor.
  const access = await docAccess(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), doc.id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The row menu's read: the role fields it has always read, plus what it
  // may offer (menuCaps). Lean, because a menu opening needs no content,
  // signed URLs, lock owner, location or versions.
  if (new URL(req.url).searchParams.get("menu") === "1") {
    const caps = await menuCaps(ctx, doc, access);
    return NextResponse.json({
      doc: { id: doc.id, createdById: doc.createdById },
      myRole: roleAtLeast(access.role, "EDIT") ? "edit" : access.role === "COMMENT" ? "comment" : "view",
      canManage: access.canManage,
      canShare: access.canShare,
      canComment: access.canComment,
      ...caps,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  // Refresh presigned URLs for image / file blocks backed by S3. The
  // stored URL is a 1-hour signature; re-signing per read keeps doc
  // viewing fast and the URL always usable, mirroring the SOP
  // screenshot enrichment pattern.
  const enriched = { ...doc, content: await presignBlocksImagesAndFiles(doc.content) };

  // Lock page (change request A4): while lockedById is set everyone below
  // Full access reads as view-only on the CONTENT; comments keep working, which
  // is the point of locking rather than restricting. The lock row rides back
  // so the editor can name who locked it and offer Unlock to a Full holder.
  const lockRow = await readDocLock(doc.id);
  let lock: { byId: string; byName: string | null; at: Date | null } | null = null;
  if (lockRow?.lockedById) {
    const by = await prisma.user.findFirst({ where: { id: lockRow.lockedById }, select: { firstName: true, lastName: true } });
    lock = { byId: lockRow.lockedById, byName: by ? `${by.firstName ?? ""} ${by.lastName ?? ""}`.trim() || null : null, at: lockRow.lockedAt };
  }
  // A4: below Full access a locked doc resolves to COMMENT, not view (the
  // resolver applies it). The content is read-only, the comment composer
  // stays, and the chip reads "Can comment". "view" is read only: a Can view
  // grant never comments, and a lock never widens.
  const myRole: "edit" | "comment" | "view" = roleAtLeast(access.role, "EDIT") ? "edit" : access.role === "COMMENT" ? "comment" : "view";
  // The anchor as a Location (spec-docs-knowledge section 1, Back / close):
  // the editor's BackButton falls back to the anchor page for an anchored
  // doc, and the breadcrumb names it.
  const [location, parent, owner] = await Promise.all([
    resolveDocLocation(doc),
    doc.parentId ? readableParent(ctx, doc.parentId) : Promise.resolve(null),
    doc.createdById ? prisma.user.findFirst({ where: { id: doc.createdById }, select: { id: true, firstName: true, lastName: true, avatar: true } }) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    doc: enriched,
    myRole,
    lock,
    // Full access: lock, Trash, save as template.
    canManage: access.canManage,
    // Can edit or higher changes who can open it (today's doc sharing rule).
    canShare: access.canShare,
    // Can comment or higher: a Can view grant reads only.
    canComment: access.canComment,
    location,
    parent,
    owner: owner ? { id: owner.id, name: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || null, avatar: owner.avatar } : null,
  });
}

// The save path lives in src/lib/docs/doc-save.ts, so an AI teammate's tools
// run it as the person they act for (docs/plans/ai-teammates.md 3.15). The
// session and the body are read here; everything about the doc is decided
// there.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  return saveDocAs(ctx, id, body);
}

// PATCH is an alias of PUT. Some clients (the topbar Notepad quick-tool) issue
// PATCH for partial title/content updates; without this export Next returns 405
// and the write is silently lost. PUT already handles partial bodies
// (title ?? existing, content ?? existing), so delegating is correct + safe.
export const PATCH = PUT;

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const existing = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true, createdById: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(existing, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const role = await requireDocRole(ctx, { id, createdById: existing.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role === "view") return NextResponse.json({ error: "read-only" }, { status: 403 });
  if (existing.archivedAt) return NextResponse.json({ ok: true, alreadyArchived: true });

  // Soft-archive only — the row stays, versions stay.
  // archivedById is what Trash's "Archived by" column reads; the helper keeps
  // the archive working if the column has not been added yet.
  await withArchivedBy(ctx.userId, (extra) =>
    prisma.doc.update({ where: { id }, data: { archivedAt: new Date(), ...extra } }),
  );
  return NextResponse.json({ ok: true });
}
