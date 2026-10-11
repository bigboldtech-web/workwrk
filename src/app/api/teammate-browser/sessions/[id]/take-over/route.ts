// POST /api/teammate-browser/sessions/[id]/take-over { organizationId, actionId?: string }
//
// The person takes their own browser over (docs/plans/ai-teammates-phase4.md
// Decision 19, browser/take-over.ts startTakeOver), from the browser card or
// from the teammate's ask_to_take_over card (actionId): every browser tool of
// the session is locked until they hand it back. Only someone a teammate may
// act for here (the AI app, resolveActingPerson: 403 person_cannot), their own
// session only (404). The live view's address is answered no-store. 20 a
// minute per person.

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveActingPerson } from "@/lib/agents/acting";
import { BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireApp } from "@/lib/app-gate";
import { startTakeOver } from "@/lib/browser/take-over";
import { rateLimit } from "@/lib/rate-limit-memory";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ organizationId: z.string().min(1).max(200).optional(), actionId: z.string().min(1).max(64).optional() }).strict();

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", CONNECTION_ROUTE_ERRORS.personCannot);
  const limited = rateLimit(`browser-take-over:${viewer.userId}`, { max: 20, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", BROWSER_ROUTE_ERRORS.rateLimited(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  const out = await startTakeOver(viewer, (await params).id, parsed.data.actionId ?? null);
  if (!out.ok) return teammateError(out.status, out.code, out.error, NO_STORE);
  return NextResponse.json({ session: out.view, liveView: { url: out.url, interactive: true } }, { headers: NO_STORE });
}
