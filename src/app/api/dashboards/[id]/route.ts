// GET    /api/dashboards/[id]: one dashboard, its cards as THIS viewer may see them
// PATCH  /api/dashboards/[id]: rename / describe / pin / replace the cards
// DELETE /api/dashboards/[id]: soft archive (Restore: POST .../restore)
//
// Editing belongs to the owner and to org Owners and Admins. A PATCH is a
// compare-and-swap on updatedAt (expectedUpdatedAt is required), and a card
// list may only drop a card it names in removedWidgetIds, so a stale tab or an
// older client can never delete a card by leaving it out. A submitted
// passthrough card is replaced by the STORED value, so nobody can write
// arbitrary JSON through one.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { canContributeSpaceFor, spaceForViewer } from "@/lib/list-links-server";
import { canEditDashboard, notFound, readDashboard, requireWorkApp, widgetReader } from "@/lib/dashboards/dashboard-server";
import { redactForViewer } from "@/lib/dashboards/widget-data";
import {
  checkWidgetRemovals,
  parseWidgets,
  resolvePassthrough,
  serializeWidgets,
  widgetInputSchema,
  WIDGET_LIMIT,
} from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c);
  if (!found) return notFound();
  const { row, spaceMissing } = found;
  const canEdit = canEditDashboard(row, c);
  const stored = parseWidgets(row.widgets);
  // Editors get the list as stored, passthrough values included, because
  // they are the ones who may change it; everyone else gets it redacted.
  const widgets = canEdit ? stored : await redactForViewer(stored, await widgetReader(c, app.viewer, null));
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c);
  if (!found) return notFound();
  if (!canEditDashboard(found.row, c)) {
    return NextResponse.json({ error: "no_access", reason: "not_dashboard_owner" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  if (!parsed.data.expectedUpdatedAt) return NextResponse.json({ error: "version_required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.spaceId !== undefined) {
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
    data.widgets = serializeWidgets(resolved.widgets) as object;
  }

  // Compare-and-swap on the version the editor saw.
  const swapped = await prisma.dashboard.updateMany({
    where: { id, organizationId: c.organizationId, archivedAt: null, updatedAt: new Date(parsed.data.expectedUpdatedAt) },
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
  if (!canEditDashboard(found.row, c)) {
    return NextResponse.json({ error: "no_access", reason: "not_dashboard_owner" }, { status: 403 });
  }
  // A soft archive. Its schedules stay: each due run records
  // target_unavailable until the dashboard is restored.
  await prisma.dashboard.updateMany({ where: { id, organizationId: c.organizationId, archivedAt: null }, data: { archivedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
