// PATCH  /api/agents/routines/[id] { name?, prompt?, schedule?, status? }
//        Change one of this person's routines, pause it, or resume it.
//        Resuming counts its next run from now (a paused routine has none),
//        so it never fires the moment it is turned back on.
// DELETE /api/agents/routines/[id]: stop it for good. Its past reports stay
//        in the chat.
//
// Only the person a routine works for (actingForId): anyone else's routine,
// an Admin's view of it included, is the same 404 as a missing one.
//
// A SKILL'S ROUTINE (docs/plans/ai-teammates-phase5.md Decision 22, step 5)
// keeps its rules on this path too: a new schedule must also remind at most
// once a day (400 too_often, skillRoutineScheduleProblem), and its prompt,
// the person's run message, is never changed (400 invalid,
// skillRoutinePrompt). Its name and status change as any routine's.
//
// docs/plans/ai-teammates.md 3.9 and 4. Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { personZone } from "@/lib/agents/acting";
import { nextRoutineRun, routineTeammatePrint } from "@/lib/agents/routines-server";
import { scheduleForSave } from "@/lib/agents/cron";
import { ROUTINE_LIMITS, routineScheduleProblem, skillRoutineScheduleProblem } from "@/lib/agents/routines";
import { canUseAgent } from "@/lib/agents/teammate-access";
import { SKILL_ROUTE_ERRORS, TEAMMATE_ERRORS, TEAMMATE_ROUTE_ERRORS, removedComposer } from "@/lib/agents/teammate-copy";
import { invalidRequest, routineSkillNames, teammateError } from "@/lib/agents/teammate-server";
import { ROUTINE_VIEW_SELECT, routineViewFromRow } from "@/lib/agents/teammate-views";

type Params = { params: Promise<{ id: string }> };

function routineNotFound() {
  return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.routineNotFound);
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(ROUTINE_LIMITS.nameMax).optional(),
    prompt: z.string().trim().min(1).max(ROUTINE_LIMITS.promptMax).optional(),
    schedule: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

export async function PATCH(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const routine = await prisma.agentRoutine.findFirst({
    where: { id, organizationId: viewer.organizationId, actingForId: viewer.userId },
    select: { ...ROUTINE_VIEW_SELECT, agentId: true, agent: { select: { name: true, status: true, organizationId: true, visibility: true, ownerId: true } } },
  });
  if (!routine || !canUseAgent(routine.agent, viewer)) return routineNotFound();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const b = parsed.data;
  // A skill's routine has no instructions to change: its prompt is the person's run message (Phase 5 step 5).
  const skillRoutine = Boolean(routine.skillId);
  if (skillRoutine && b.prompt !== undefined) return teammateError(400, "invalid", SKILL_ROUTE_ERRORS.skillRoutinePrompt);
  const zone = await personZone(viewer.userId, viewer.organizationId);

  const data: Prisma.AgentRoutineUpdateInput = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.prompt !== undefined) data.prompt = b.prompt;
  let schedule = routine.schedule;
  if (b.schedule !== undefined) {
    schedule = scheduleForSave(b.schedule.replace(/\s+/g, " "), zone);
    const problem = routineScheduleProblem(schedule);
    if (problem === "too_often") return teammateError(400, "too_often", TEAMMATE_ERRORS.routineTooOften);
    if (problem) return teammateError(400, "invalid_schedule", TEAMMATE_ERRORS.routineInvalid);
    // At most once a day for a skill's routine, on this path as at creation (Decision 22).
    if (skillRoutine && skillRoutineScheduleProblem(schedule) !== null) return teammateError(400, "too_often", SKILL_ROUTE_ERRORS.routineTooOften);
    data.schedule = schedule;
  }
  const active = routine.status === "active";
  // A routine paused because its schedule named no time starts again once
  // it is given one (its reason says so): review round 2.
  const restarts = !active && b.status === undefined && b.schedule !== undefined && routine.pausedReason === "no_next_run";
  if ((b.status === "active" && !active) || restarts) {
    // A routine of a removed teammate stays paused: it could only pause again.
    if (routine.agent.status === "ARCHIVED") return teammateError(409, "agent_removed", removedComposer(routine.agent.name));
    // Its own next slot, never an hourly fallback: a schedule with none
    // cannot resume (runDueSlot would only pause it again).
    const next = nextRoutineRun(schedule, new Date());
    if (!next) return teammateError(400, "invalid_schedule", TEAMMATE_ERRORS.routineInvalid);
    data.status = "active";
    data.pausedReason = null;
    data.nextRunAt = next;
    // Resumed by its person: the teammate as it is now is the one they chose
    // (a routine paused because its teammate changed tells them to check it
    // first; review round 10).
    data.teammatePrint = await routineTeammatePrint(viewer.organizationId, routine.agentId);
  } else if (b.status === "paused" && active) {
    // Paused by its person: no reason, and no next run until they resume it.
    data.status = "paused";
    data.pausedReason = null;
    data.nextRunAt = null;
  } else if (active && b.schedule !== undefined) {
    // A new schedule on a running routine: its next slot, from now.
    data.nextRunAt = nextRoutineRun(schedule, new Date());
  }

  const updated = await prisma.agentRoutine.update({ where: { id: routine.id }, data, select: ROUTINE_VIEW_SELECT });
  return NextResponse.json({ routine: routineViewFromRow(updated, zone, await routineSkillNames([updated], viewer)) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const gone = await prisma.agentRoutine.deleteMany({ where: { id, organizationId: viewer.organizationId, actingForId: viewer.userId } });
  if (gone.count === 0) return routineNotFound();
  return NextResponse.json({ ok: true });
}
