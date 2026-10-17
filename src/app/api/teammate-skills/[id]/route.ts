// GET    /api/teammate-skills/[id]: one of the signed-in person's own skills,
//        whole (SkillView): its steps as the step editor shows them.
// PATCH  /api/teammate-skills/[id] { organizationId, version, name?,
//        description?, steps?: [{ id, title?, value?, forgetName?: true }],
//        startHome?: true, ready?: true }: the person's review or edit
//        (Decision 11), answering the skill as it is now.
// DELETE /api/teammate-skills/[id] { organizationId }: the person deletes it
//        (Decision 14); its routines go with it.
//
// docs/plans/ai-teammates-phase5.md step 3, Decisions 11, 13, 14, 24, 25, 26
// and 28. Every method reads by the viewer's own id: anyone else's skill, an
// Owner's request included, is 404, as a missing one is (Decision 25).
//
// GET and DELETE need a signed-in viewer only, never the AI app (Decision 13:
// a person can always read and delete their own skills); PATCH needs the AI
// app (requireApp), as every other teammate write does. A write names the
// workspace the tab was read in: a session switched in another tab answers
// 409 workspace_changed and changes nothing.
//
// PATCH's refusals, each its real reason: 400 invalid; 400 bad_step (with
// stepId); 400 bad_value (with problem: sensitive, control, empty or
// too_long); 400 bad_title (with stepId); 400 too_many_steps; 400 no_steps;
// 400 name_needed and name_sensitive; 400 description_sensitive; 404; 409
// skill_changed; 409 still_recording; 409 name_taken; 409 workspace_changed;
// 429 rate_limited (60 a minute). DELETE's: 404; 409 still_recording
// (Discard in the browser card instead); 409 workspace_changed.

import { NextResponse } from "next/server";
import { z } from "zod";
import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS, SKILL_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireApp } from "@/lib/app-gate";
import { rateLimit } from "@/lib/rate-limit-memory";
import { deleteOwnSkill, editOwnSkill, readOwnSkill, type SkillRefusal } from "@/lib/skills/manage";
import { SKILL_LIMITS } from "@/lib/skills/types";

type Params = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A refusal as the tab reads it: `{ error, code }`, with the step and the
 * value's problem where it has one, also as `issues` (api-fetch.ts hands a
 * route's structured detail to the page there).
 */
function refused(r: SkillRefusal): NextResponse {
  const detail = { ...(r.stepId ? { stepId: r.stepId } : {}), ...(r.problem ? { problem: r.problem } : {}) };
  return NextResponse.json({ error: r.error, code: r.code, ...detail, ...(Object.keys(detail).length > 0 ? { issues: detail } : {}) }, { status: r.status, headers: NO_STORE });
}

export async function GET(_req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const view = await readOwnSkill(viewer, (await params).id);
  if (!view) return teammateError(404, "not_found", SKILL_ROUTE_ERRORS.notFound);
  return NextResponse.json(view, { headers: NO_STORE });
}

// Only the fields a review may change (Decision 11): a step's id, title,
// value and forgetName. Anything else a step carries (a site, a name, an
// address) is dropped here and rebuilt from the stored step (steps.ts
// editSkill), never written.
const valueSchema = z.union([z.object({ ask: z.literal(true) }).strict(), z.object({ fixed: z.string().max(SKILL_LIMITS.fixedTextMax + 200) }).strict()]);
const stepSchema = z.object({
  id: z.string().min(1).max(16),
  title: z.string().max(400).optional(),
  value: valueSchema.optional(),
  forgetName: z.literal(true).optional(),
});

// organizationId: optional in the schema only so that naming none answers
// workspace_changed below, never a bare 400 (the Phase 3 routes' rule).
const patchSchema = z
  .object({
    organizationId: z.string().min(1).max(200).optional(),
    version: z.number().int().min(1),
    name: z.string().max(400).optional(),
    description: z.string().max(SKILL_LIMITS.descriptionMax + 200).optional(),
    steps: z.array(stepSchema).max(SKILL_LIMITS.recordedStepsMax).optional(),
    startHome: z.literal(true).optional(),
    ready: z.literal(true).optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const limited = rateLimit(`teammate-skill-edit:${viewer.userId}`, { max: 60, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", BROWSER_ROUTE_ERRORS.rateLimited(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  const b = parsed.data;
  const out = await editOwnSkill(viewer, (await params).id, {
    version: b.version,
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.description !== undefined ? { description: b.description } : {}),
    ...(b.steps !== undefined
      ? {
          steps: b.steps.map((s) => ({
            id: s.id,
            ...(s.title !== undefined ? { title: s.title } : {}),
            ...(s.value !== undefined ? { value: "ask" in s.value ? { ask: true as const } : { fixed: s.value.fixed } } : {}),
            ...(s.forgetName ? { forgetName: true as const } : {}),
          })),
        }
      : {}),
    ...(b.startHome ? { startHome: true as const } : {}),
    ...(b.ready ? { ready: true as const } : {}),
  });
  if (!out.ok) return refused(out);
  return NextResponse.json(out.skill, { headers: NO_STORE });
}

const deleteSchema = z.object({ organizationId: z.string().min(1).max(200).optional() }).strict();

export async function DELETE(req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const out = await deleteOwnSkill(viewer, (await params).id);
  if (!out.ok) return refused(out);
  return NextResponse.json({ deleted: true }, { headers: NO_STORE });
}
