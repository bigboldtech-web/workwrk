// GET    /api/dashboards/[id]: one dashboard, its cards as THIS viewer may see them
// PATCH  /api/dashboards/[id]: rename / describe / pin / replace the cards
// DELETE /api/dashboards/[id]: soft archive (Restore: POST .../restore)
//
// Editing belongs to the owner and to org Owners and Admins, and on a Space's
// Overview (id spaceOverviewId) to that Space's managers instead of the owner
// (canEditDashboard). A PATCH is a compare-and-swap on updatedAt
// (expectedUpdatedAt is required), and a card list may only drop a card it
// names in removedWidgetIds, so a stale tab or an older client can never
// delete a card by leaving it out. A submitted passthrough card is replaced
// by the STORED value, so nobody can write arbitrary JSON through one.
//
// EDITORS SEE ONLY WHAT THEY CAN READ. GET gives an editor redactForEditor:
// a card they cannot read at all is { id, kind: "hidden" }, a partly readable
// one is the readable part flagged `partial`. PATCH computes the same
// visibility for the caller over the STORED cards and puts back what they
// could not see (restoreHiddenParts): a hidden card may only come back as
// { id, kind: "passthrough" } or be removed (400 widget_locked), a partial
// card keeps its unseen Lists and rules (400 source_locked, too_many_lists,
// too_many_rules instead of a silent cut).
//
// VERSION FIRST. PATCH answers 409 conflict as soon as the row it read is not
// the version the editor saw, BEFORE the removal check, so a stale tab always
// takes the conflict path; the compare-and-swap still covers the race after
// the read.
//
// THE OVERVIEW. A spaceId key on it is 400 overview_pinned, every new or
// changed data card must stay inside its Space (400 overview_source), and it
// is never archived (409 overview_not_archivable). A spaceMissing Overview is
// an ordinary unpinned dashboard everywhere except that it cannot be archived
// or re-pinned, because its Space may come back from Trash.
//
// ARCHIVED HINT. A GET for an archived row answers 404 { archived: true } only
// to someone who may restore it; everyone else gets the plain 404.
//
// A Guest is answered 404 by requireWorkApp, like a missing object.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { canContributeSpaceFor, listReader, spaceForViewer } from "@/lib/list-links-server";
import { canEditDashboard, isOverviewRow, notFound, readDashboard, requireWorkApp, widgetReader } from "@/lib/dashboards/dashboard-server";
import { editorVisibility, redactForEditor, redactForViewer } from "@/lib/dashboards/widget-data";
import { isSpaceOverviewId, overviewSourceProblem } from "@/lib/dashboards/dashboard-access";
import {
  checkWidgetRemovals,
  parseWidgets,
  resolvePassthrough,
  restoreHiddenParts,
  serializeWidgets,
  widgetInputSchema,
  WIDGET_LIMIT,
  type Widget,
} from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c);
  if (!found) {
    const archived = await readDashboard(id, c, { archived: true });
    if (archived && (await canEditDashboard(archived.row, c, archived.spaceMissing))) {
      return NextResponse.json({ error: "Not found", archived: true }, { status: 404 });
    }
    return notFound();
  }
  const { row, spaceMissing } = found;
  const canEdit = await canEditDashboard(row, c, spaceMissing);
  const stored = parseWidgets(row.widgets);
  const reader = await widgetReader(c, app.viewer, null);
  const lists = listReader(c);
  // Editors see what they can read and a marker for the rest; readers get
  // the reader redaction. Neither is ever sent a List they cannot read.
  const widgets = canEdit ? await redactForEditor(stored, reader, lists) : await redactForViewer(stored, reader, lists);
  const owner = row.ownerId
    ? await prisma.user.findFirst({ where: { id: row.ownerId, organizationId: c.organizationId }, select: { id: true, firstName: true, lastName: true, avatar: true } })
    : null;
  return NextResponse.json(
    {
      dashboard: {
        id: row.id,
        name: row.name,
        description: row.description,
        ownerId: row.ownerId,
        spaceId: row.spaceId,
        ...(spaceMissing ? { spaceMissing: true } : {}),
        widgets,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      canEdit,
      owner,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const patchSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
  spaceId: z.string().min(1).max(64).nullable().optional(),
  widgets: z.array(widgetInputSchema).max(WIDGET_LIMIT).optional(),
  removedWidgetIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});

function sameStored(a: Widget, b: Widget): boolean {
  return JSON.stringify(serializeWidgets([a])) === JSON.stringify(serializeWidgets([b]));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c);
  if (!found) return notFound();
  if (!(await canEditDashboard(found.row, c, found.spaceMissing))) {
    return NextResponse.json({ error: "no_access", reason: "not_dashboard_owner" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  if (!parsed.data.expectedUpdatedAt) return NextResponse.json({ error: "version_required" }, { status: 400 });
  const expected = new Date(parsed.data.expectedUpdatedAt);

  // Version first: a stale editor is told so before anything else is judged.
  if (found.row.updatedAt.getTime() !== expected.getTime()) {
    return NextResponse.json({ error: "conflict", liveUpdatedAt: found.row.updatedAt }, { status: 409 });
  }

  // The Overview stays with its Space, including one whose Space is gone for
  // now (it may come back from Trash).
  const overviewId = isSpaceOverviewId(found.row.id);
  const liveOverview = isOverviewRow(found.row) && !found.spaceMissing;

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.spaceId !== undefined) {
    if (overviewId) return NextResponse.json({ error: "overview_pinned" }, { status: 400 });
    if (parsed.data.spaceId) {
      if (!(await spaceForViewer(c, parsed.data.spaceId))) return notFound();
      if (!(await canContributeSpaceFor(c, parsed.data.spaceId))) {
        return NextResponse.json({ error: "no_access", reason: "space_read_only" }, { status: 403 });
      }
    }
    data.spaceId = parsed.data.spaceId;
  }
  if (parsed.data.widgets !== undefined) {
    const stored = parseWidgets(found.row.widgets);
    const missing = checkWidgetRemovals(stored, parsed.data.widgets.map((w) => w.id), parsed.data.removedWidgetIds ?? []);
    if (missing.length) return NextResponse.json({ error: "widget_missing", ids: missing }, { status: 409 });
    const resolved = resolvePassthrough(parsed.data.widgets, stored);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: 400 });

    if (liveOverview && found.row.spaceId) {
      // Only what this editor wrote is judged: a card kept verbatim was
      // judged when it was written, and a List that later moved to another
      // Space must not lock the whole Overview.
      const storedById = new Map(stored.map((w) => [w.id, w] as const));
      const written = resolved.widgets.filter((w) => {
        const s = storedById.get(w.id);
        return !s || !sameStored(w, s);
      });
      const listIds = Array.from(new Set(written.flatMap((w) => ("source" in w && w.source.kind === "lists" ? w.source.listIds : []))));
      const boards = listIds.length
        ? await prisma.board.findMany({ where: { id: { in: listIds }, organizationId: c.organizationId }, select: { id: true, spaceId: true } })
        : [];
      const spaceOf = new Map(boards.map((b) => [b.id, b.spaceId] as const));
      for (const w of written) {
        if ("source" in w && overviewSourceProblem(w.source, found.row.spaceId, spaceOf)) {
          return NextResponse.json({ error: "overview_source", id: w.id }, { status: 400 });
        }
      }
    }

    const visibility = await editorVisibility(stored, await widgetReader(c, app.viewer, null), listReader(c));
    const restored = restoreHiddenParts(stored, resolved.widgets, visibility);
    if (!restored.ok) return NextResponse.json({ error: restored.error, id: restored.id }, { status: 400 });
    data.widgets = serializeWidgets(restored.widgets) as object;
  }

  // Compare-and-swap on the version the editor saw.
  const swapped = await prisma.dashboard.updateMany({
    where: { id, organizationId: c.organizationId, archivedAt: null, updatedAt: expected },
    data,
  });
  if (swapped.count === 0) {
    const live = await prisma.dashboard.findFirst({ where: { id, organizationId: c.organizationId }, select: { updatedAt: true } });
    return NextResponse.json({ error: "conflict", liveUpdatedAt: live?.updatedAt ?? null }, { status: 409 });
  }
  const dashboard = await prisma.dashboard.findFirst({ where: { id, organizationId: c.organizationId }, select: { id: true, name: true, updatedAt: true } });
  return NextResponse.json({ dashboard });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c);
  if (!found) return notFound();
  if (!(await canEditDashboard(found.row, c, found.spaceMissing))) {
    return NextResponse.json({ error: "no_access", reason: "not_dashboard_owner" }, { status: 403 });
  }
  // A Space's Overview is part of the Space: its widgets are removed one by
  // one, and the row itself is never archived (an archive could be restored
  // over a newer Overview, or leave the Space unable to make a new one).
  if (isSpaceOverviewId(found.row.id)) {
    return NextResponse.json({ error: "overview_not_archivable" }, { status: 409 });
  }
  // A soft archive. Its schedules stay: each due run records
  // target_unavailable until the dashboard is restored.
  await prisma.dashboard.updateMany({ where: { id, organizationId: c.organizationId, archivedAt: null }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
