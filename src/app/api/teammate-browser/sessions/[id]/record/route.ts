// POST /api/teammate-browser/sessions/[id]/record { organizationId, name, actionId?: string }
//
// The person starts showing their teammate how to do a job in its browser
// (docs/plans/ai-teammates-phase5.md Decisions 5 and 6, step 2;
// src/lib/skills/recorder.ts startRecording): a take over with the recorder
// on, from the browser card's Show how (no actionId) or from the teammate's
// ask_to_show_me card (actionId), which moves to RUNNING with the session.
// `name` is the person's own words for the job (1 to 80 characters, made one
// line and plain), never the model's. Only someone a teammate may act for
// here (the AI app, resolveActingPerson: 403 person_cannot), their own
// session only (404, an Owner's request included). The live view's address
// is answered no-store. 20 a minute per person.
//
// Refusals, each its own (Decision 28): 404; 409 ended; 409 busy; 409
// card_decided; 403 person_cannot; 403 skills_off; 409 cant_learn; 409
// too_late; 409 already_recording; 409 too_many_for_teammate; 409 too_many;
// 409 name_taken; 429 recordings_today; 429 rate_limited; 409
// workspace_changed; and the computer's own (403 trial, plan, workspace_off;
// 409 workspace_closed, no_sites; 503 not_configured), 409 no_page (no web
// page open yet), 400 name_needed and name_sensitive.

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveActingPerson } from "@/lib/agents/acting";
import { plainData } from "@/lib/agents/plain-data";
import { BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS, SKILL_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireApp } from "@/lib/app-gate";
import { redactPageText } from "@/lib/browser/redact";
import { rateLimit } from "@/lib/rate-limit-memory";
import { startRecording } from "@/lib/skills/recorder";
import { SKILL_LIMITS } from "@/lib/skills/types";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    organizationId: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(400),
    actionId: z.string().min(1).max(64).optional(),
  })
  .strict();

const NO_STORE = { "Cache-Control": "no-store" };

/** The person's words for the job: one line, plain, its runs of white space made one, control and invisible characters gone. */
function cleanName(raw: string): string {
  return plainData(raw)
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", CONNECTION_ROUTE_ERRORS.personCannot);
  const limited = rateLimit(`browser-record:${viewer.userId}`, { max: 20, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", BROWSER_ROUTE_ERRORS.rateLimited(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  const name = cleanName(parsed.data.name);
  if (!name) return teammateError(400, "name_needed", SKILL_ROUTE_ERRORS.nameNeeded);
  if (name.length > SKILL_LIMITS.nameMax) return invalidRequest();
  // A name the model reads as data (Decision 16) never carries a card number or a code.
  if (redactPageText(name).hidden > 0) return teammateError(400, "name_sensitive", SKILL_ROUTE_ERRORS.nameSensitive);
  const out = await startRecording(viewer, (await params).id, { name, actionId: parsed.data.actionId ?? null });
  if (!out.ok) return teammateError(out.status, out.code, out.error, NO_STORE);
  return NextResponse.json({ session: out.view, liveView: { url: out.url, interactive: true }, skillId: out.skillId }, { headers: NO_STORE });
}
