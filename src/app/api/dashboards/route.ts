// GET  /api/dashboards?spaceId=&mine=1&archived=1: the org's dashboards
// POST /api/dashboards: create one { name, description?, spaceId?, widgets? },
//      or a Space's Overview widgets { overview: true, spaceId, name, widgets }
//
// Decision 1 reverses the 2026-08-28 removal. A dashboard is org-visible,
// like a Whiteboard; one pinned to a Space is listed where that Space is
// readable, and one whose Space was deleted is listed as unpinned
// (`spaceMissing`), never hidden. What any card SHOWS is computed per viewer
// (GET /api/dashboards/[id]/data).
//
// Rows carry `owner` { id, firstName, lastName, avatar } | null (one
// org-scoped user read) and `space` { id, name, slug } | null (null when
// unpinned or spaceMissing), for the /dashboards list's Owner and Location.
//
// A Space's OVERVIEW row (id spaceOverviewId(spaceId), dashboard-access.ts)
// is never listed while its Space exists, under any filter: it belongs to the
// Space's Overview tab, not to this list. A spaceMissing one lists like any
// unpinned dashboard. Creating it: the Space readable (else 404) and managed
// by the caller (canEditSpace, else 403 space_manage_only), every card over
// that Space or Lists inside it (else 400 overview_source), and the primary
// key makes a second one impossible (409 overview_exists).
//
// A Guest is answered 404 by requireWorkApp, like a missing object.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { canContributeSpaceFor, canEditSpaceFor, spaceForViewer, viewerIsOrgAdmin, visibleSpacesFor } from "@/lib/list-links-server";
import { canEditDashboard, isOverviewRow, requireWorkApp } from "@/lib/dashboards/dashboard-server";
import { overviewSourceProblem, spaceOverviewId } from "@/lib/dashboards/dashboard-access";
import { parseWidgets, resolvePassthrough, serializeWidgets, widgetInputSchema, WIDGET_LIMIT, type Widget } from "@/lib/dashboards/widgets";

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
    pinned.length
      ? prisma.space.findMany({ where: { id: { in: pinned }, organizationId: c.organizationId }, select: { id: true, name: true, slug: true } })
      : Promise.resolve([]),
    pinned.length ? visibleSpacesFor(c, pinned) : Promise.resolve(new Set<string>()),
  ]);
  const spaceById = new Map(existing.map((s) => [s.id, s] as const));
  const listed = rows.filter((r) => {
    if (!r.spaceId) return true;
    if (!spaceById.has(r.spaceId)) return true;
    // The Overview of a Space that exists lives on that Space's Overview tab.
    if (isOverviewRow(r)) return false;
    return visible.has(r.spaceId);
  });

  const ownerIds = Array.from(new Set(listed.map((r) => r.ownerId).filter((id): id is string => !!id)));
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds }, organizationId: c.organizationId }, select: { id: true, firstName: true, lastName: true, avatar: true } })
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u] as const));

  const dashboards = await Promise.all(
    listed.map(async (r) => {
      const space = r.spaceId ? spaceById.get(r.spaceId) ?? null : null;
      const spaceMissing = !!r.spaceId && !space;
      const owner = r.ownerId ? ownerById.get(r.ownerId) ?? null : null;
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        ownerId: r.ownerId,
        owner: owner ? { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, avatar: owner.avatar } : null,
        spaceId: r.spaceId,
        space: space ? { id: space.id, name: space.name, slug: space.slug } : null,
        ...(spaceMissing ? { spaceMissing: true } : {}),
        widgetCount: parseWidgets(r.widgets).length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        archivedAt: r.archivedAt,
        canEdit: await canEditDashboard(r, c, spaceMissing),
      };
    }),
  );
  return NextResponse.json({ dashboards }, { headers: { "Cache-Control": "private, no-store" } });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  spaceId: z.string().min(1).max(64).optional(),
  overview: z.literal(true).optional(),
  widgets: z.array(widgetInputSchema).max(WIDGET_LIMIT).optional(),
});

/** The first card on an Overview whose source leaves its Space, or null. */
async function overviewSourceRefusal(widgets: readonly Widget[], spaceId: string, organizationId: string): Promise<string | null> {
  const listIds = Array.from(new Set(widgets.flatMap((w) => ("source" in w && w.source.kind === "lists" ? w.source.listIds : []))));
  const boards = listIds.length
    ? await prisma.board.findMany({ where: { id: { in: listIds }, organizationId }, select: { id: true, spaceId: true } })
    : [];
  const spaceOf = new Map(boards.map((b) => [b.id, b.spaceId] as const));
  for (const w of widgets) {
    if (!("source" in w)) continue;
    if (overviewSourceProblem(w.source, spaceId, spaceOf)) return w.id;
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "P2002";
}

export async function POST(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  // A passthrough names a STORED card, and a new dashboard has none.
  const resolved = resolvePassthrough(parsed.data.widgets ?? [], []);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: 400 });

  if (parsed.data.overview) {
    const spaceId = parsed.data.spaceId;
    if (!spaceId) return NextResponse.json({ error: "Invalid body", issues: [{ path: ["spaceId"], message: "an Overview needs its Space" }] }, { status: 400 });
    if (!(await spaceForViewer(c, spaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canEditSpaceFor(c, spaceId))) {
      return NextResponse.json({ error: "no_access", reason: "space_manage_only" }, { status: 403 });
    }
    const outside = await overviewSourceRefusal(resolved.widgets, spaceId, c.organizationId);
    if (outside) return NextResponse.json({ error: "overview_source", id: outside }, { status: 400 });
    try {
      const dashboard = await prisma.dashboard.create({
        data: {
          id: spaceOverviewId(spaceId),
          organizationId: c.organizationId,
          name: parsed.data.name,
          description: parsed.data.description,
          spaceId,
          ownerId: c.userId,
          widgets: serializeWidgets(resolved.widgets) as object,
        },
        select: { id: true, name: true, spaceId: true, createdAt: true, updatedAt: true },
      });
      return NextResponse.json({ dashboard }, { status: 201 });
    } catch (err) {
      // Someone created it first. The client reads it and adds its card.
      if (isUniqueViolation(err)) return NextResponse.json({ error: "overview_exists" }, { status: 409 });
      throw err;
    }
  }

  if (parsed.data.spaceId) {
    if (!(await spaceForViewer(c, parsed.data.spaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canContributeSpaceFor(c, parsed.data.spaceId))) {
      return NextResponse.json({ error: "no_access", reason: "space_read_only" }, { status: 403 });
    }
  }

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
