// POST /api/teammate-skills/[id]/routine { organizationId, schedule, name? }
//
// Make a routine from one of the signed-in person's own ready skills
// (docs/plans/ai-teammates-phase5.md Decision 22, step 5): a reminder that
// starts with the person. At its time it writes one line in their chat with
// the skill's teammate, with Start, and one Inbox row; it runs no model and
// no browser and spends no AI question (routines-server.ts remindSkill).
// Start sends the person's own run message, so they are there for every
// card, sign-in and take over.
//
// It is a routine like any other (createRoutine): the person's own, with the
// skill's teammate, within ROUTINE_LIMITS, its teammate's print kept as any
// routine keeps it, made "settings". Its name is the skill's unless one is
// given; its prompt is the run message (SKILLS_COPY.startMessage), which
// nothing runs and no edit changes (the routine PATCH refuses a prompt). It
// reminds at most once a day (skillRoutineScheduleProblem), here and on the
// routine PATCH. A skill deleted takes its routines with it (the key cascades).
//
// Every read is the viewer's own (Decision 25): anyone else's skill is 404,
// as a missing one is. It needs the AI app (requireApp), the skill ready, its
// teammate one the person may use and not removed, teaching by showing and
// the computer available with that teammate now (recorder.ts skillsAccess,
// each refusal its real reason), and the person someone a teammate may act
// for. A write names the workspace the tab was read in: a session switched
// in another tab answers 409 workspace_changed. One audit row
// (teammate_skill.routine), personal, with the skill's steps and hosts only.
//
// Refusals, each { error, code }: 400 invalid; 400 too_often; 400
// invalid_schedule; 400 limit; 403 person_cannot; 404 not_found; 409
// skill_draft; 409 agent_removed; 409 workspace_changed; 429 rate_limited;
// and skillsAccess's (403 skills_off, 409 cant_learn, and the computer's).

import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { resolveActingPerson } from "@/lib/agents/acting";
import { computerAgentFrom } from "@/lib/agents/browser-access";
import { scheduleForSave } from "@/lib/agents/cron";
import { ROUTINE_LIMITS } from "@/lib/agents/routines";
import { createRoutine } from "@/lib/agents/routines-server";
import { canUseAgent } from "@/lib/agents/teammate-access";
import { ACTION_ERRORS, BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS, SKILL_AUDIT_COPY, SKILL_ROUTE_ERRORS, SKILLS_COPY, TEAMMATE_ROUTE_ERRORS, removedComposer } from "@/lib/agents/teammate-copy";
import { TEAMMATE_SELECT, invalidRequest, routineSkillNames, teammateError } from "@/lib/agents/teammate-server";
import { ROUTINE_VIEW_SELECT, routineViewFromRow } from "@/lib/agents/teammate-views";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit-memory";
import { skillsAccess, skillsRefusal } from "@/lib/skills/recorder";
import { skillSites, storedSteps } from "@/lib/skills/steps";
import { ownSkill } from "@/lib/skills/store";

type Params = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

// organizationId: optional in the schema only so that naming none answers
// workspace_changed below, never a bare 400 (the Phase 3 routes' rule).
const postSchema = z
  .object({
    organizationId: z.string().min(1).max(200).optional(),
    schedule: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(ROUTINE_LIMITS.nameMax).optional(),
  })
  .strict();

/** A database error's code only (the conventions: never its detail, which can hold the row). */
function codeOf(err: unknown): string {
  return err instanceof Error ? err.name : "error";
}

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const limited = rateLimit(`teammate-skill-routine:${viewer.userId}`, { max: 20, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", BROWSER_ROUTE_ERRORS.rateLimited(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });

  // The viewer's own skill, ready (Decision 25: anyone else's is not there).
  const skill = await ownSkill(viewer, (await params).id);
  if (!skill) return teammateError(404, "not_found", SKILL_ROUTE_ERRORS.notFound);
  if (skill.status !== "ready") return teammateError(409, "skill_draft", SKILL_ROUTE_ERRORS.notReady);

  // Its teammate, one the person may use, and not removed.
  const agent = await prisma.agent.findFirst({ where: { id: skill.agentId, organizationId: viewer.organizationId }, select: TEAMMATE_SELECT });
  if (!agent || !canUseAgent(agent, viewer)) return teammateError(404, "not_found", SKILL_ROUTE_ERRORS.notFound);
  if (agent.status === "ARCHIVED") return teammateError(409, "agent_removed", removedComposer(agent.name));
  // Skills available with this teammate now: a reminder of a skill nothing could run is no routine.
  const learn = await skillsAccess({ organizationId: viewer.organizationId, agent: computerAgentFrom(agent) });
  if (!learn.ok) {
    const r = skillsRefusal(learn.reason, agent.name);
    return teammateError(r.status, r.code, r.error);
  }
  // Start acts as this person, so they must be someone a teammate can act for now; their zone is the one a picked time is read in.
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const zone = acting.person.timezone;

  const made = await createRoutine({
    organizationId: viewer.organizationId,
    agentId: agent.id,
    actingForId: viewer.userId,
    name: parsed.data.name ?? skill.name,
    prompt: SKILLS_COPY.startMessage(skill.name),
    schedule: scheduleForSave(parsed.data.schedule.replace(/\s+/g, " "), zone),
    createdVia: "settings",
    zone,
    skillId: skill.id,
  });
  if (!made.ok) return teammateError(400, made.code, made.message);

  // Hosts and counts only (Decision 24): never the skill's name, a step's words or the schedule's.
  const steps = storedSteps(skill.steps);
  const sites = skillSites(steps);
  await logActivity({
    type: "teammate_skill.routine",
    actorId: viewer.userId,
    actingForId: viewer.userId,
    organizationId: viewer.organizationId,
    description: SKILL_AUDIT_COPY.routine(steps.length, sites.join(", ")),
    targetId: agent.id,
    targetType: "agent",
    metadata: { skillId: skill.id, agentId: agent.id, routineId: made.routine.id, steps: steps.length, sites },
    severity: "info",
  }).catch((err) => console.error(`[skills] routine audit ${codeOf(err)}`));

  const row = await prisma.agentRoutine.findFirst({ where: { id: made.routine.id }, select: ROUTINE_VIEW_SELECT });
  // Deleted from another tab a moment after it was made.
  if (!row) return teammateError(404, "not_found", TEAMMATE_ROUTE_ERRORS.routineNotFound);
  return NextResponse.json({ routine: routineViewFromRow(row, zone, await routineSkillNames([row], viewer)) }, { status: 201, headers: NO_STORE });
}
