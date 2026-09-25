// GET /api/whiteboards — list this org's whiteboards
// POST /api/whiteboards — create a new whiteboard

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { nodeCtxFromLevel, nodeRole, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { getEffectivePreferences } from "@/lib/preferences";
import { matchesCanvasFilters, matchesCanvasView, parseCanvasListQuery, sortCanvases, type CanvasCandidate } from "@/lib/canvas-list";
import { sliceByCursor } from "@/lib/list-query";

/**
 * GET /api/whiteboards?view=all|recent|my|favorites&q=&location=&owner=
 *   &editedFrom=&editedTo=&sort=edited|name|owner|created&dir=&cursor=&limit=40
 *   -> { data: CanvasRow[], total, nextCursor }
 *
 * The /canvas list page (spec-docs-knowledge section 2). The gate (Space
 * visibility) runs over every candidate BEFORE the page slice, so the total
 * is real and a viewer can reach canvas 201. The legacy `{ whiteboards }`
 * shape (200 newest) survives for the callers that pass none of these params
 * (the card pickers, the Space tree).
 */
async function pagedList(req: Request, ctx: { orgId: string; userId: string; accessLevel: string | null | undefined }) {
  const q = parseCanvasListQuery(new URL(req.url).searchParams);
  const [rows, prefs] = await Promise.all([
    prisma.whiteboard.findMany({
      where: { organizationId: ctx.orgId, archivedAt: null },
      select: { id: true, name: true, description: true, thumbnail: true, ownerId: true, lastEditedAt: true, spaceId: true, folderId: true, createdAt: true, updatedAt: true },
    }),
    getEffectivePreferences(ctx.userId, ctx.orgId),
  ]);
  const scopedIds = [...new Set(rows.map((w) => w.spaceId).filter((x): x is string => !!x))];
  // One world for every candidate (the one resolver): a canvas follows its
  // Folder when that Folder is in its Space (the Private cut included), else
  // its Space; its owner with reach and a canvas grant open it too.
  const roles = await nodeRoleMap(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), "canvas", rows.map((w) => w.id));
  const gated = rows.filter((w) => roleAtLeast(roles.get(w.id) ?? "none", "VIEW"));

  const home = prefs.home as { favoriteWhiteboardIds?: string[] };
  const facts = { userId: ctx.userId, favoriteIds: new Set<string>(Array.isArray(home.favoriteWhiteboardIds) ? home.favoriteWhiteboardIds : []) };

  const ownerIds = [...new Set(gated.map((w) => w.ownerId).filter((x): x is string => !!x))];
  const [users, spaces] = await Promise.all([
    ownerIds.length ? prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, firstName: true, lastName: true, avatar: true } }) : Promise.resolve([]),
    scopedIds.length ? prisma.space.findMany({ where: { id: { in: scopedIds } }, select: { id: true, name: true, slug: true, icon: true, color: true } }) : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const spaceById = new Map(spaces.map((sp) => [sp.id, sp]));
  const nameOf = (id: string | null) => { const u = id ? userById.get(id) : undefined; return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : ""; };

  const filtered: (CanvasCandidate & typeof gated[number])[] = gated
    .map((w) => ({ ...w, ownerName: nameOf(w.ownerId) }))
    .filter((w) => matchesCanvasView(w, q.view, facts) && matchesCanvasFilters(w, q));
  const sorted = sortCanvases(filtered, q.sort, q.dir);
  const { page, nextCursor } = sliceByCursor(sorted, q.cursor, q.limit);

  const data = page.map((w) => {
    const u = w.ownerId ? userById.get(w.ownerId) : undefined;
    const sp = w.spaceId ? spaceById.get(w.spaceId) : undefined;
    return {
      id: w.id,
      name: w.name,
      description: w.description,
      thumbnail: w.thumbnail,
      ownerId: w.ownerId,
      owner: u ? { id: u.id, name: nameOf(u.id) || null, avatar: u.avatar, firstName: u.firstName, lastName: u.lastName } : null,
      spaceId: w.spaceId,
      folderId: w.folderId ?? null,
      location: sp ? { type: "SPACE", id: sp.id, name: sp.name, icon: sp.icon, color: sp.color, href: `/spaces/${sp.slug}` } : null,
      lastEditedAt: w.lastEditedAt,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      favorite: facts.favoriteIds.has(w.id),
    };
  });
  return NextResponse.json({ data, total: sorted.length, nextCursor });
}

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  if (parseCanvasListQuery(new URL(req.url).searchParams).paged) return pagedList(req, ctx);

  // Optional ?spaceId filter for the Library Space chip strip. "unscoped"
  // is a sentinel: return only whiteboards with spaceId IS NULL.
  const sp = new URL(req.url).searchParams;
  const spaceIdParam = sp.get("spaceId");
  const spaceFilter: Record<string, unknown> =
    spaceIdParam === "unscoped"
      ? { spaceId: null }
      : spaceIdParam
        ? { spaceId: spaceIdParam }
        : {};

  const whiteboards = await prisma.whiteboard.findMany({
    where: { organizationId: ctx.orgId, archivedAt: null, ...spaceFilter },
    select: {
      id: true,
      name: true,
      description: true,
      thumbnail: true,
      ownerId: true,
      lastEditedAt: true,
      productSlug: true,
      spaceId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ lastEditedAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  // One world for every row (the one resolver): unscoped canvases stay
  // org-wide for Members, a canvas in a Space or Folder follows it, and a
  // canvas grant opens its canvas.
  const roles = await nodeRoleMap(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), "canvas", whiteboards.map((w) => w.id));
  const gated = whiteboards.filter((w) => roleAtLeast(roles.get(w.id) ?? "none", "VIEW"));

  return NextResponse.json({ whiteboards: gated });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  productSlug: z.string().max(40).optional(),
  spaceId: z.string().min(1).optional(),
  /**
   * The Folder a Canvas was created from. Optional, and a row without it is
   * anchored to the Space exactly as every existing row is
   * (prisma/sql/2026-09-19-canvas-folder.sql).
   */
  folderId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // A folder id from a request body is a claim, not a fact. Unchecked, any
  // signed-in person with an id could plant a Canvas inside a folder they
  // cannot open. `createBoard` validates its own folderId the same way.
  let folderId: string | null = null;
  let spaceId = parsed.data.spaceId ?? null;
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  if (parsed.data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: parsed.data.folderId, organizationId: ctx.orgId, archivedAt: null },
      select: { id: true, spaceId: true },
    });
    if (!folder) return NextResponse.json({ error: "That folder no longer exists" }, { status: 404 });
    // Full access on the Folder creates in it (W2), never the Space's rights.
    const d = await nodeRole(nodeCtx, { kind: "folder", id: folder.id });
    if (d.role === "none" && !d.path) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!roleAtLeast(d.role, "FULL")) {
      return NextResponse.json({ error: "You need Full access to that folder." }, { status: 403 });
    }
    folderId = folder.id;
    // The folder settles the Space, so the two keys in one body cannot disagree.
    spaceId = folder.spaceId;
  } else if (spaceId) {
    // The Space root: Can view on the Space, as today.
    const d = await nodeRole(nodeCtx, { kind: "space", id: spaceId });
    if (!roleAtLeast(d.role, "VIEW")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The column is new (prisma/sql/2026-09-19-canvas-folder.sql). A deployment
  // that ships this code before the file is applied still creates Canvases; the
  // one on a Folder simply anchors to the Space until the column lands.
  let whiteboard: { id: string; name: string; createdAt: Date };
  const base = {
    organizationId: ctx.orgId,
    name: parsed.data.name,
    description: parsed.data.description,
    productSlug: parsed.data.productSlug,
    spaceId: spaceId ?? undefined,
    ownerId: ctx.userId,
    lastEditedById: ctx.userId,
    lastEditedAt: new Date(),
    scene: {},
  };
  try {
    whiteboard = await prisma.whiteboard.create({
      data: { ...base, folderId: folderId ?? undefined },
      select: { id: true, name: true, createdAt: true },
    });
  } catch (err) {
    if (!folderId) throw err;
    whiteboard = await prisma.whiteboard.create({
      data: base,
      select: { id: true, name: true, createdAt: true },
    });
  }

  return NextResponse.json({ whiteboard });
}
