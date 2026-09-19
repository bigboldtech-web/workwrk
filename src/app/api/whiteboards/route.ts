// GET /api/whiteboards — list this org's whiteboards
// POST /api/whiteboards — create a new whiteboard

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { visibleSpaceIds, canEditSpace, getSpaceForReader } from "@/lib/space";
import { folderReadable } from "@/lib/folder";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

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

  // Phase 22 — gate by Space visibility. Unscoped whiteboards (spaceId=null)
  // stay visible org-wide; scoped ones are returned only if the viewer
  // can read the parent Space.
  const scopedIds = whiteboards.map((w) => w.spaceId).filter((s): s is string => Boolean(s));
  const visible = scopedIds.length > 0
    ? await visibleSpaceIds(scopedIds, ctx.userId, ctx.accessLevel ?? "EMPLOYEE")
    : new Set<string>();
  const gated = whiteboards.filter((w) => !w.spaceId || visible.has(w.spaceId));

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
  if (parsed.data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: parsed.data.folderId, organizationId: ctx.orgId, archivedAt: null },
      select: { id: true, spaceId: true },
    });
    if (!folder) return NextResponse.json({ error: "That folder no longer exists" }, { status: 404 });
    if (!(await folderReadable(folder.id, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!(await canEditSpace(folder.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"))) {
      return NextResponse.json({ error: "You need edit access to that folder." }, { status: 403 });
    }
    folderId = folder.id;
    // The folder settles the Space, so the two keys in one body cannot disagree.
    spaceId = folder.spaceId;
  } else if (spaceId) {
    if (!(await getSpaceForReader(spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE"))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
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
