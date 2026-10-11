// POST /api/teammate-browser/sessions/[id]/live-view { organizationId }
//
// The live view of the person's own browser (docs/plans/ai-teammates-phase4.md
// Decision 19): its address minted for this request from the provider, never
// stored or logged, answered with Cache-Control: no-store, and only when its
// origin is the provider's (browserbase.ts liveViewUrl). `interactive` only
// while the person has taken it over; otherwise the card shows it view-only.
// Anyone else's, an Owner's included, is 404. A browser whose guard this
// process no longer holds is closed rather than shown: nothing may drive it.
// 30 a minute per person.

import { NextResponse } from "next/server";
import { z } from "zod";
import { BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireApp } from "@/lib/app-gate";
import { liveViewUrl } from "@/lib/browser/browserbase";
import { browserConfig } from "@/lib/browser/config";
import { BOOT_ID, liveBrowser } from "@/lib/browser/live";
import { endBrowserSession, ownSessionRow, SYSTEM_END } from "@/lib/browser/sessions";
import { rateLimit } from "@/lib/rate-limit-memory";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ organizationId: z.string().min(1).max(200).optional() }).strict();

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const row = await ownSessionRow(viewer, (await params).id);
  if (!row) return teammateError(404, "not_found", BROWSER_ROUTE_ERRORS.notFound);
  const limited = rateLimit(`browser-live-view:${viewer.userId}`, { max: 30, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", BROWSER_ROUTE_ERRORS.rateLimited(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  if (row.status === "ended" || row.status === "ending") return teammateError(409, "ended", BROWSER_ROUTE_ERRORS.ended);
  const cfg = browserConfig();
  if (!cfg) {
    await endBrowserSession(row.id, "turned_off", SYSTEM_END);
    return teammateError(409, "ended", BROWSER_ROUTE_ERRORS.ended);
  }
  const lb = liveBrowser(row.id);
  if (row.bootId !== BOOT_ID || !lb || lb.lost) {
    await endBrowserSession(row.id, lb?.lost ? "provider_ended" : "restarted", SYSTEM_END);
    return teammateError(409, "ended", BROWSER_ROUTE_ERRORS.ended);
  }
  if (!row.providerSessionId) return teammateError(503, "provider_unavailable", BROWSER_ROUTE_ERRORS.liveViewFailed, NO_STORE);
  const url = await liveViewUrl(cfg, row.providerSessionId);
  if (!url.ok) return teammateError(503, "provider_unavailable", BROWSER_ROUTE_ERRORS.liveViewFailed, NO_STORE);
  return NextResponse.json({ url: url.data, interactive: row.status === "handed_over" }, { headers: NO_STORE });
}
