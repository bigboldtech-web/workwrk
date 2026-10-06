// Routines, the server half (docs/plans/ai-teammates.md 3.9): saving one,
// running one (runRoutine: Run now, and the scheduled runner's run of a due
// slot), and pausing one. The rules are routines.ts; the scheduled runner
// (processDueRoutines: the due slots, claimed by compare-and-swap) joins this
// file with the cron step and runs each slot through runRoutine.
//
// A routine works for ONE person, set at creation and never changed: its
// actingForId is the person who asked for it, re-checked on every run, and
// never a fallback to anyone else. It runs at most once an hour (every run
// spends one AI question), and one person has at most ROUTINE_LIMITS of them.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { isAiConfigured } from "@/lib/ai-client";
import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { prisma } from "@/lib/prisma";
import { resolveActingPerson } from "./acting";
import { writeEventLine } from "./actions";
import { computeNextRunAt } from "./autonomous";
import { claimTeammateTurn, giveBackTurn } from "./budget";
import { splitScheduleZone } from "./cron";
import { TEAMMATE_AGENT_SELECT, getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom } from "./engine";
import { ROUTINE_LIMITS, ROUTINE_REASON_TEXT, routineReasonForPerson, routineScheduleProblem, type RoutineReason } from "./routines";
import { describeSchedule, wordsInZone } from "./schedule-words";
import { canUseAgent } from "./teammate-access";
import { TEAMMATE_CHAT, TEAMMATE_ERRORS, routineLimitMessage, routinePausedLine } from "./teammate-copy";
import { clampText } from "./clamp";

export interface RoutineCreated {
  id: string;
  name: string;
  schedule: string;
  /** The schedule in words, its zone named when it is not the person's: "Weekdays at 9:00". */
  when: string;
  nextRunAt: string;
}

export type CreateRoutineResult =
  | { ok: true; routine: RoutineCreated }
  | { ok: false; code: "invalid" | "invalid_schedule" | "too_often" | "limit"; message: string };

/**
 * Save a routine for `actingForId` with one teammate, active from now: its
 * first run is the schedule's next slot. `zone` is the person's own zone, for
 * the words only (the schedule carries its own CRON_TZ=).
 */
export async function createRoutine(a: {
  organizationId: string;
  agentId: string;
  actingForId: string;
  name: string;
  prompt: string;
  schedule: string;
  createdVia: "chat" | "settings";
  zone?: string | null;
  now?: Date;
}): Promise<CreateRoutineResult> {
  const name = clampText(String(a.name ?? "").trim().replace(/\s+/g, " "), ROUTINE_LIMITS.nameMax).trim();
  const prompt = clampText(String(a.prompt ?? "").trim(), ROUTINE_LIMITS.promptMax).trim();
  if (!name || !prompt) return { ok: false, code: "invalid", message: TEAMMATE_ERRORS.routineInvalid };
  const schedule = String(a.schedule ?? "").trim();
  const problem = routineScheduleProblem(schedule);
  if (problem === "too_often") return { ok: false, code: "too_often", message: TEAMMATE_ERRORS.routineTooOften };
  if (problem) return { ok: false, code: "invalid_schedule", message: TEAMMATE_ERRORS.routineInvalid };

  const [withThis, all] = await Promise.all([
    prisma.agentRoutine.count({ where: { agentId: a.agentId, actingForId: a.actingForId } }),
    prisma.agentRoutine.count({ where: { organizationId: a.organizationId, actingForId: a.actingForId } }),
  ]);
  if (withThis >= ROUTINE_LIMITS.perTeammate) return { ok: false, code: "limit", message: routineLimitMessage(ROUTINE_LIMITS.perTeammate, "teammate") };
  if (all >= ROUTINE_LIMITS.perPerson) return { ok: false, code: "limit", message: routineLimitMessage(ROUTINE_LIMITS.perPerson, "person") };

  const now = a.now ?? new Date();
  const nextRunAt = computeNextRunAt(schedule, now);
  const row = await prisma.agentRoutine.create({
    data: {
      organizationId: a.organizationId,
      agentId: a.agentId,
      actingForId: a.actingForId,
      name,
      prompt,
      schedule,
      status: "active",
      nextRunAt,
      createdVia: a.createdVia,
    },
    select: { id: true, name: true, schedule: true, nextRunAt: true },
  });
  return {
    ok: true,
    routine: {
      id: row.id,
      name: row.name,
      schedule: row.schedule,
      when: wordsInZone(describeSchedule(row.schedule, true), splitScheduleZone(row.schedule).zone, a.zone ?? null),
      nextRunAt: (row.nextRunAt ?? nextRunAt).toISOString(),
    },
  };
}

// ── Pausing one ─────────────────────────────────────────────────────

/** The routine columns a pause reads. */
export interface PausableRoutine {
  id: string;
  organizationId: string;
  agentId: string;
  actingForId: string;
  name: string;
}

/**
 * Pause a routine for a reason (3.9): status paused with the reason kept, no
 * next run, and the line "Routine paused: {name}. {reason}" in its person's
 * chat with the teammate. One swap from active, so a routine paused twice at
 * once writes one line. Only its person resumes it (PATCH
 * /api/agents/routines/[id]). True when this call paused it.
 */
export async function pauseRoutine(r: PausableRoutine, reason: RoutineReason): Promise<boolean> {
  const paused = await prisma.agentRoutine.updateMany({
    where: { id: r.id, status: "active" },
    data: { status: "paused", pausedReason: reason, nextRunAt: null },
  });
  if (paused.count !== 1) return false;
  const chat = await prisma.chatSession.findFirst({
    where: { organizationId: r.organizationId, agentId: r.agentId, userId: r.actingForId, kind: "TEAMMATE", archivedAt: null },
    select: { id: true },
  });
  await writeEventLine(chat?.id ?? null, { text: routinePausedLine(r.name, ROUTINE_REASON_TEXT[reason]), event: "routine_paused", routineId: r.id });
  return true;
}

// ── Running one ─────────────────────────────────────────────────────

/** The routine columns a run reads. */
export const ROUTINE_RUN_SELECT = {
  id: true,
  organizationId: true,
  agentId: true,
  actingForId: true,
  name: true,
  prompt: true,
  schedule: true,
  status: true,
} as const;

export type RoutineRunRow = Prisma.AgentRoutineGetPayload<{ select: typeof ROUTINE_RUN_SELECT }>;

/**
 * A run that never started: why, and the sentence for it. `pause` says what
 * the scheduled runner does with it: pause the routine (pauseRoutine), or
 * skip this one slot. rate_limited is Run now's alone (the scheduled runner
 * claims without the per-minute limit).
 */
export interface RoutineRefusal {
  ok: false;
  reason: RoutineReason | "rate_limited";
  message: string;
  pause: boolean;
  retryAfter?: number;
}

export interface RoutineRun {
  ok: true;
  runId: string;
  sessionId: string;
  /** FAILED when the turn ended early or never answered. */
  status: "SUCCEEDED" | "FAILED";
  /** ai_failed when the AI never answered: its question was given back. */
  reason: RoutineReason | null;
  /** The report (a REPORT ChatMessage), null when none was written. */
  messageId: string | null;
  approvalMessageId: string | null;
  /** What the run asked its person to approve. */
  proposedActionIds: string[];
  error: string | null;
  /** The person it ran as. */
  personId: string;
  agent: { id: string; slug: string; name: string };
}

export type RoutineRunResult = RoutineRun | RoutineRefusal;

function refusal(reason: RoutineReason, pause: boolean, message: string = ROUTINE_REASON_TEXT[reason]): RoutineRefusal {
  return { ok: false, reason, message, pause };
}

/**
 * Run one routine now, as the person it works for, and record it on the
 * routine. Every check is made again, in this order, before anything is
 * spent:
 *   the workspace's AI is off             skip    ai_off
 *   the teammate was removed              pause   agent_removed
 *   the teammate is paused                skip    agent_paused
 *   the person may not be acted for now   pause   their reason (resolveActingPerson)
 *   the person can't use the teammate     pause   no_access
 *   AI isn't set up                       skip    not_configured
 *   the teammate's month is used          skip    agent_cap
 *   the plan's questions are used         pause   out_of_questions
 *   the person's per-minute limit         Run now only: rate_limited
 * A refusal changes nothing: Run now answers with it, and the scheduled
 * runner pauses or skips as `pause` says. A run the AI never answered gives
 * its question back (Ask AI's rule) and is recorded FAILED with ai_failed. A
 * practice run changes nothing, so it leaves the routine's last run as it
 * was. `dueAt` is the slot it runs for (the report's meta), else now.
 */
export async function runRoutine(
  r: RoutineRunRow,
  opts: { practice: boolean; rateLimit: boolean; dueAt?: Date | null; now?: Date },
): Promise<RoutineRunResult> {
  const now = opts.now ?? new Date();
  const [org, agent] = await Promise.all([
    prisma.organization.findUnique({ where: { id: r.organizationId }, select: { settings: true } }),
    prisma.agent.findFirst({
      where: { id: r.agentId, organizationId: r.organizationId },
      select: { ...TEAMMATE_AGENT_SELECT, status: true, visibility: true, ownerId: true },
    }),
  ]);
  if (!org || !aiEnabledFromSettings(org.settings)) return refusal("ai_off", false, TEAMMATE_CHAT.aiOff);
  if (!agent || agent.status === "ARCHIVED") return refusal("agent_removed", true);
  if (agent.status === "DISABLED") return refusal("agent_paused", false);
  const acting = await resolveActingPerson(r.organizationId, r.actingForId);
  if (!acting.ok) return refusal(routineReasonForPerson(acting.reason), true);
  const person = acting.person;
  if (!canUseAgent(agent, person.viewer)) return refusal("no_access", true);
  if (!(await isAiConfigured(r.organizationId))) return refusal("not_configured", false);

  const session = await getOrCreateTeammateSession(agent, person.userId);
  const claim = await claimTeammateTurn({
    organizationId: r.organizationId,
    agentId: agent.id,
    userId: person.userId,
    what: "AI teammate routine",
    trigger: "ROUTINE",
    sessionId: session.id,
    routineId: r.id,
    practice: opts.practice,
    rateLimit: opts.rateLimit,
  });
  if (!claim.ok) {
    if (claim.code === "rate_limited") return { ok: false, reason: "rate_limited", message: claim.message, pause: false, retryAfter: claim.retryAfter };
    if (claim.code === "agent_cap") return refusal("agent_cap", false, claim.message);
    if (claim.code === "ai_limit") return refusal("out_of_questions", true, claim.message);
    return refusal("agent_removed", true);
  }

  const turn = await runTeammateTurn({
    agent: teammateAgentFrom(agent),
    person,
    sessionId: session.id,
    trigger: "ROUTINE",
    userText: null,
    practice: opts.practice,
    routine: { id: r.id, name: r.name, prompt: r.prompt, dueAt: opts.dueAt ?? now },
    runId: claim.runId,
    questionId: claim.questionId,
    streaming: false,
  });
  if (turn.failedBeforeAnything) await giveBackTurn(claim.runId, claim.questionId);
  const status = turn.error ? "FAILED" : "SUCCEEDED";
  const reason: RoutineReason | null = turn.failedBeforeAnything ? "ai_failed" : null;
  if (!opts.practice) {
    await prisma.agentRoutine
      .updateMany({ where: { id: r.id }, data: { lastRunAt: now, lastRunId: claim.runId, lastStatus: status, lastReason: reason } })
      .catch((err) => console.error(`[agents] routine ${r.id} run not recorded: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`));
  }
  return {
    ok: true,
    runId: claim.runId,
    sessionId: session.id,
    status,
    reason,
    messageId: turn.assistantMessageId,
    approvalMessageId: turn.approvalMessageId,
    proposedActionIds: turn.proposedActionIds,
    error: turn.error,
    personId: person.userId,
    agent: { id: agent.id, slug: agent.slug, name: agent.name },
  };
}
