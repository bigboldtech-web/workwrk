// GET  /api/dashboards?spaceId=&mine=1&archived=1: the org's dashboards
// POST /api/dashboards: create one { name, description?, spaceId?, widgets? }
//
// Decision 1 reverses the 2026-08-28 removal. A dashboard is org-visible,
// like a Whiteboard; one pinned to a Space (a Space Overview) is listed where
// that Space is readable, and one whose Space was deleted is listed as
// unpinned (`spaceMissing`), never hidden. What any card SHOWS is computed per
// viewer (GET /api/dashboards/[id]/data).

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { canContributeSpaceFor, spaceForViewer, viewerIsOrgAdmin, visibleSpacesFor } from "@/lib/list-links-server";
import { canEditDashboard, requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { parseWidgets, resolvePassthrough, serializeWidgets, widgetInputSchema, WIDGET_LIMIT } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const sp = new URL(req.url).searchParams;
  const mine = sp.get("mine") === "1";
  const archived = sp.get("archived") === "1";
  const spaceId = sp.get("spaceId");
  const admin = viewerIsOrgAdmin(c);

  const rows = await prisma.dashboard.findMany({
    where: {
      organizationId: c.organizationId,
      // Archived rows are for Restore, so only the ones the caller may restore.
      ...(archived ? { archivedAt: { not: null }, ...(admin ? {} : { ownerId: c.userId }) } : { archivedAt: null }),
      ...(mine ? { ownerId: c.userId } : {}),
      ...(spaceId ? { spaceId } : {}),
    },
    orderBy: spaceId ? { createdAt: "asc" } : { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true, description: true, ownerId: true, spaceId: true, widgets: true, createdAt: true, updatedAt: true, archivedAt: true },
  });

  // A pinned row is listed when its Space is readable (a batch read, never
  // widened by a folder grant) or when the Space no longer exists.
  const pinned = Array.from(new Set(rows.map((r) => r.spaceId).filter((s): s is string => !!s)));
  const [existing, visible] = await Promise.all([
    pinned.length ? prisma.space.findMany({ where: { id: { in: pinned }, organizationId: c.organizationId }, select: { id: true } }) : Promise.resolve([]),
    pinned.length ? visibleSpacesFor(c, pinned) : Promise.resolve(new Set<string>()),
  ]);
  const exists = new Set(existing.map((s) => s.id));
  const dashboards = rows
    .filter((r) => !r.spaceId || !exists.has(r.spaceId) || visible.has(r.spaceId))
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.ownerId,
      spaceId: r.spaceId,
      ...(r.spaceId && !exists.has(r.spaceId) ? { spaceMissing: true } : {}),
      widgetCount: parseWidgets(r.widgets).length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      archivedAt: r.archivedAt,
      canEdit: canEditDashboard(r, c),
    }));
  return NextResponse.json({ dashboards }, { headers: { "Cache-Control": "private, no-store" } });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  spaceId: z.string().min(1).max(64).optional(),
  widgets: z.array(widgetInputSchema).max(WIDGET_LIMIT).optional(),
});

export async function POST(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  if (parsed.data.spaceId) {
    if (!(await spaceForViewer(c, parsed.data.spaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canContributeSpaceFor(c, parsed.data.spaceId))) {
      return NextResponse.json({ error: "no_access", reason: "space_read_only" }, { status: 403 });
    }
  }
  // A passthrough names a STORED card, and a new dashboard has none.
  const resolved = resolvePassthrough(parsed.data.widgets ?? [], []);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: 400 });

  const dashboard = await prisma.dashboard.create({
    data: {
      organizationId: c.organizationId,
      name: parsed.data.name,
      description: parsed.data.description,
      spaceId: parsed.data.spaceId ?? null,
      ownerId: c.userId,
      widgets: serializeWidgets(resolved.widgets) as object,
    },
    select: { id: true, name: true, spaceId: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ dashboard }, { status: 201 });
}
