// GET /api/dashboards/[id]/data?widget=&tz=: every card's numbers, for THIS viewer.
//
// Each card is redacted exactly as GET /api/dashboards/[id] redacts it for
// this viewer, then computed over the Lists they can read now (widget-data.ts).
// A card none of whose Lists they can read answers { kind: "empty" } and names
// nothing; a card that fails answers { kind: "error" } alone and the rest
// still come back. ?widget= computes one card.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { notFound, readDashboard, requireWorkApp, widgetReader } from "@/lib/dashboards/dashboard-server";
import { computeWidget, redactForViewer, type WidgetResult } from "@/lib/dashboards/widget-data";
import { parseWidgets } from "@/lib/dashboards/widgets";
import { listReader } from "@/lib/list-links-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const { id } = await params;
  const found = await readDashboard(id, c);
  if (!found) return notFound();
  const sp = new URL(req.url).searchParams;
  const only = sp.get("widget");
  const reader = await widgetReader(c, app.viewer, sp.get("tz"));
  const lists = listReader(c);
  const cards = (await redactForViewer(parseWidgets(found.row.widgets), reader, lists)).filter((w) => !only || w.id === only);
  const widgets: Record<string, WidgetResult> = {};
  for (const w of cards) widgets[w.id] = await computeWidget(w, reader, lists);
  return NextResponse.json(
    { widgets, zone: reader.zone, computedAt: reader.now.toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
