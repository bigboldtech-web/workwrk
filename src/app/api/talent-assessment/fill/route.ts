// /api/talent-assessment/fill (spec-teams-performance /talent "Fill from
// scores", the confirmed replacement for the GET that wrote rows).
//
// GET  ?period=  -> { wouldPlace, skipped }: the count the confirm names
//                ("Place 11 people who have a performance score and no
//                placement for Q3 2026?"). Reads only.
// POST { period } -> { placed, skipped }: places them. Idempotent: a person
//                already placed for the period is never touched, so a double
//                click or a second run places nobody twice.
//
// Anyone who holds the page may run it over the people they can see (the
// People team and Admin: the org; a manager: their chain), which is what
// the old auto-place allowed, now behind a confirm.

import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { fillFromScores, talentCtx } from "@/lib/performance/talent.server";

function periodOf(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 100) : "";
}

export async function GET(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);
  const period = periodOf(new URL(req.url).searchParams.get("period"));
  if (!period) return jsonError("period required");
  const res = await fillFromScores(ctx, period, { dryRun: true });
  return jsonSuccess({ wouldPlace: res.placed, skipped: res.skipped, period });
}

export async function POST(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);
  const body = ((await req.json().catch(() => null)) ?? {}) as { period?: unknown };
  const period = periodOf(body.period);
  if (!period) return jsonError("period required");
  const res = await fillFromScores(ctx, period);
  if (res.placed > 0) {
    logActivity({
      type: "talent_assessment_auto_placed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `Placed ${res.placed} people from performance scores for ${period}`,
      targetType: "talent_assessment",
      metadata: { period, ...res },
    });
  }
  return jsonSuccess({ ...res, period });
}
