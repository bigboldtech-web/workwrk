// POST /api/dashboards/widget-preview: { widget, tz? } → { result }
//
// The card builder's live preview. It runs the SAME redact-then-compute path
// as the saved card's data (GET /api/dashboards/[id]/data), under the caller,
// so a preview can never show more than the saved card would.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx } from "@/lib/item-gate";
import { requireWorkApp, widgetReader } from "@/lib/dashboards/dashboard-server";
import { computeWidget, redactForViewer } from "@/lib/dashboards/widget-data";
import { resolvePassthrough, widgetInputSchema } from "@/lib/dashboards/widgets";
import { listReader } from "@/lib/list-links-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ widget: widgetInputSchema, tz: z.string().max(64).optional() });

export async function POST(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  // A preview has no stored card for a passthrough to name.
  const resolved = resolvePassthrough([parsed.data.widget], []);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: 400 });
  const reader = await widgetReader(c, app.viewer, parsed.data.tz ?? null);
  const lists = listReader(c);
  const [card] = await redactForViewer(resolved.widgets, reader, lists);
  return NextResponse.json({ result: await computeWidget(card, reader, lists) }, { headers: { "Cache-Control": "private, no-store" } });
}
