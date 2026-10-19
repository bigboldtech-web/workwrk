// POST /api/agents/routines/[id]/run { practice?: boolean }
//
// Run now: one run of this person's routine, now, synchronously, as the
// person it works for (routines-server.ts runRoutine, the same run the
// scheduler makes of a due slot). It claims one AI question under the
// person's per-minute limit, as a chat message does, and answers
// { runId, status, messageId }: the run, how it went, and its report in the
// chat. A practice run changes nothing and says what it would have done.
//
// Only the person a routine works for: anyone else's is the same 404 as a
// missing one. Refusals as POST .../messages: 409 agent_paused or
// agent_removed, 503 not_configured, 403 agent_cap or ai_limit, 429
// rate_limited, each { error: "<sentence>", code }. A refusal changes
// nothing on the routine: the person is right here to read it. Except 409
// teammate_changed: the routine pauses, as its next slot would, so the tab
// offers Resume, which accepts the teammate as it is now (review round 11).
//
// A SKILL'S ROUTINE NEVER RUNS HERE (docs/plans/ai-teammates-phase5.md
// Decision 22, step 5): Run now and Practice run of one answer 409
// skill_routine with { start: { slug, skillId, name } } (also as `issues`,
// where api-fetch.ts hands a route's detail to the page), and the Routines
// tab sends the person's run message itself (teammate-store.ts
// sendSkillRun), so no ROUTINE turn ever runs a skill.
//
// docs/plans/ai-teammates.md 3.9 and 4.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { ROUTINE_RUN_SELECT, pauseRoutine, runRoutine, type RoutineRefusal } from "@/lib/agents/routines-server";
import { ACTION_ERRORS, SKILL_ROUTE_ERRORS, TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";

const runSchema = z.object({ practice: z.boolean().optional() });

function routineNotFound() {
  return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.routineNotFound);
}

/** A run that never started, as the chat's refusals read. */
function refusalResponse(r: RoutineRefusal): NextResponse {
  switch (r.reason) {
    case "rate_limited":
      return teammateError(429, "rate_limited", r.message, { "Retry-After": String(r.retryAfter ?? 60) });
    case "agent_removed":
    case "agent_paused":
      return teammateError(409, r.reason, r.message);
    case "not_configured":
      return teammateError(503, "not_configured", r.message);
    case "agent_cap":
      return teammateError(403, "agent_cap", r.message);
    case "out_of_questions":
    case "person_free_used":
    case "free_ai_day":
      // The claim's own sentence: which AI questions ran out, and when they come back.
      return teammateError(403, "ai_limit", r.message);
    case "no_access":
      return routineNotFound();
    case "ai_off":
      return teammateError(403, "app_off", TEAMMATE_CHAT.aiOff);
    case "teammate_changed":
      return teammateError(409, "teammate_changed", r.message);
    case "person_gone":
    case "guest":
    case "agent_account":
      // The person may not be acted for now (gone, a Guest, an agent account).
      return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
    case "ai_failed":
    case "no_answer":
    case "no_next_run":
    case "missed":
    // A skill's routine's (Phase 5 step 5): it never runs here (see the header), so none comes; should one, it says itself.
    case "skill_off":
    case "skill_not_ready":
    case "skill_tool_off":
    case "reminded":
      // Reasons a run records, never a refusal before one: should one come, it says itself.
      return teammateError(409, r.reason, r.message);
    default: {
      // Every reason answers as itself: a new one fails the type check here (review round 12).
      const unknown: never = r.reason;
      return teammateError(409, String(unknown), r.message);
    }
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  // An empty body is a plain run.
  const parsed = runSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidRequest();
  const routine = await prisma.agentRoutine.findFirst({
    where: { id, organizationId: viewer.organizationId, actingForId: viewer.userId },
    select: ROUTINE_RUN_SELECT,
  });
  if (!routine) return routineNotFound();
  if (routine.skillId) return skillRoutineStart(routine, viewer);

  const run = await runRoutine(routine, { practice: parsed.data.practice === true, rateLimit: true });
  if (!run.ok && run.reason === "teammate_changed") await pauseRoutine(routine, "teammate_changed");
  if (!run.ok) return refusalResponse(run);
  // A reminder is never run from here (see the header).
  if ("reminded" in run) return skillRoutineStart(routine, viewer);
  return NextResponse.json({ runId: run.runId, status: run.status, messageId: run.messageId });
}

/**
 * A skill's routine (see the header): 409 skill_routine with the chat and
 * the skill the tab starts, the person's own skill only, read now, so a
 * renamed skill's run message is the one the messages route checks.
 */
async function skillRoutineStart(routine: { agentId: string; skillId: string | null }, viewer: { userId: string; organizationId: string }): Promise<NextResponse> {
  const [agent, skill] = await Promise.all([
    prisma.agent.findFirst({ where: { id: routine.agentId, organizationId: viewer.organizationId }, select: { slug: true } }),
    routine.skillId
      ? prisma.teammateSkill.findFirst({ where: { id: routine.skillId, userId: viewer.userId, organizationId: viewer.organizationId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);
  if (!agent || !skill) return routineNotFound();
  const start = { slug: agent.slug, skillId: skill.id, name: skill.name };
  return NextResponse.json({ error: SKILL_ROUTE_ERRORS.skillRoutine, code: "skill_routine", start, issues: { start } }, { status: 409 });
}
