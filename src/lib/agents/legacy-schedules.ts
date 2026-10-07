// The old Workspace agents schedules, moved onto routines
// (docs/plans/ai-teammates-phase2.md step 2, Decisions 2 to 7, 28 and 29).
//
// WHY. The old autonomous loop ran a scheduled agent as whoever it could
// find: the person who triggered it, else its creator, else the first admin
// of the workspace, and it ran every tool with no card (an invitation went
// out unasked). A routine works as one person, re-checked on every run, and
// asks before anything other people would see. So each old schedule becomes
// its creator's routine, or stops with the reason shown.
//
// WHO IT WORKS AS. Only Agent.createdById. Never the person who last clicked
// Run now, and never "the first admin": this file reads no other user. A
// creator who is gone, deactivated, a Guest or an agent account, or who can
// no longer use the agent, stops the schedule, and so do no creator and a
// removed agent. A creator refused only because AI is off for them still
// gets the routine; it then skips or pauses by its own rules (runRoutine).
//
// ONCE. The cron calls convertLegacySchedules at every tick. Each move is one
// compare-and-swap on the agent row (still scheduled, never moved, the same
// schedule as read) in the same transaction as the routine insert, so two
// ticks at once move it once, and an Admin's edit between the read and the
// write leaves it for the next tick. The insert skips createRoutine's limits
// (Decision 4): a workspace that scheduled forty agents keeps forty
// schedules.
//
// RUN NOW. A Workspace agents Run now is a chat turn of the Owner or Admin
// who clicks, in their own chat with the agent, gated like any message:
// their rate limit, the agent's monthly cap, the plan's questions, and cards
// for anything other people would see.
//
// Server-only: imports prisma.

import type { Viewer } from "@/lib/access/types";
import { isAiConfigured } from "@/lib/ai-client";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { personZone, resolveActingPerson, type ActingPerson } from "./acting";
import { writeEventLine } from "./actions";
import { auditAgent } from "./audit";
import { abandonTurn, claimTeammateTurn, giveBackTurn } from "./budget";
import { clampText } from "./clamp";
import { parseCron, splitScheduleZone, withScheduleZone } from "./cron";
import { TEAMMATE_AGENT_SELECT, getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom, type TurnResult } from "./engine";
import { LEGACY_AGENT } from "./legacy-agents";
import { ROUTINE_LIMITS, legacyRoutineSchedule } from "./routines";
import { nextRoutineRun, routineTeammatePrint } from "./routines-server";
import { describeSchedule, scheduleZone, serverTimeZone, wordsInZone } from "./schedule-words";
import { canUseAgent } from "./teammate-access";
import { ACTION_ERRORS, LEGACY_COPY, TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS, TURN_ERRORS, type LegacyStopReason } from "./teammate-copy";

export type { LegacyStopReason } from "./teammate-copy";

export interface LegacyScheduleCounts {
  /** Old schedules the tick read (at most `limit`). */
  found: number;
  /** Moved onto a routine. */
  moved: number;
  /** Stopped, with the reason on the agent. */
  stopped: number;
  /** Already moved, or changed, by someone else between the read and the write. */
  taken: number;
  /** Threw: left for the next tick. */
  failed: number;
}

/** The Agent columns a move reads. */
export const LEGACY_SCHEDULE_SELECT = {
  ...TEAMMATE_AGENT_SELECT,
  status: true,
  visibility: true,
  ownerId: true,
  createdById: true,
  scheduleCron: true,
  autonomousPrompt: true,
  nextRunAt: true,
  scheduleMovedAt: true,
  scheduleRoutineId: true,
} as const;

export interface LegacyScheduleRow {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  status: string;
  visibility: string | null;
  ownerId: string | null;
  createdById: string | null;
  scheduleCron: string | null;
  autonomousPrompt: string | null;
  nextRunAt: Date | null;
  /** Set once moved; on a row read again, an older build turned its schedule back on (a rollback). */
  scheduleMovedAt?: Date | null;
  scheduleRoutineId?: string | null;
}

export type LegacyScheduleOutcome =
  | { kind: "routine"; schedule: string; changed: boolean; actingForId: string }
  | { kind: "stop"; reason: LegacyStopReason };

const stop = (reason: LegacyStopReason): LegacyScheduleOutcome => ({ kind: "stop", reason });

/** Where one old schedule goes: its creator's routine, or a stop with the reason. Reads only the creator. */
export async function legacyScheduleOutcome(agent: LegacyScheduleRow, now: Date): Promise<LegacyScheduleOutcome> {
  if (agent.status === "ARCHIVED") return stop("agent_removed");
  if (!(agent.scheduleCron ?? "").trim()) return stop("no_schedule");
  const moved = legacyRoutineSchedule(agent.scheduleCron, now);
  // A bare five-field cron ran on the server's clock: it keeps its times,
  // and now names the zone, so the words and a later edit read it right
  // (review round 1). The keywords keep reading in that zone (scheduleZone).
  // Every bare cron, a changed one too ("0,30 9-17 * * 1-5" becomes
  // "0 9-17 * * 1-5"), so a later edit never moves its times (review round 2).
  const schedule = moved.ok && parseCron(moved.schedule) && !splitScheduleZone(moved.schedule).zone ? { ...moved, schedule: withScheduleZone(moved.schedule, serverTimeZone()) } : moved;
  if (!schedule.ok) return stop("unsupported_schedule");
  const creator = agent.createdById;
  if (!creator) return stop("no_creator");
  const routine: LegacyScheduleOutcome = { kind: "routine", schedule: schedule.schedule, changed: schedule.changed, actingForId: creator };
  const acting = await resolveActingPerson(agent.organizationId, creator);
  if (acting.ok) return canUseAgent(agent, acting.person.viewer) ? routine : stop("no_access");
  if (acting.reason === "ai_off") {
    // The person is a member and a person (Guests and agent accounts are
    // refused before AI is checked); only who may use the agent is left.
    return agent.visibility === "WORKSPACE" || agent.ownerId === creator ? routine : stop("no_access");
  }
  if (acting.reason === "guest") return stop("guest");
  if (acting.reason === "agent_account") return stop("agent_account");
  return stop("person_gone");
}

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/**
 * Move up to `limit` old schedules (the cron's step 3). Once nothing is left
 * to move this is one indexed read per tick: no agent can be scheduled the
 * old way any more (PATCH .../schedule answers use_routines).
 */
export async function convertLegacySchedules(now: Date, opts: { limit: number }): Promise<LegacyScheduleCounts> {
  // Every schedule that is on, a moved one included: an older build (after a
  // rollback) can turn a moved schedule back on, and it must neither run the
  // old ungated way nor sit unseen (review round 1).
  const rows = await prisma.agent.findMany({
    where: { ...LEGACY_AGENT, autonomousEnabled: true },
    orderBy: { id: "asc" },
    take: opts.limit,
    select: LEGACY_SCHEDULE_SELECT,
  });
  const counts: LegacyScheduleCounts = { found: rows.length, moved: 0, stopped: 0, taken: 0, failed: 0 };
  for (const agent of rows) {
    try {
      const done = await moveOne(agent, now);
      counts[done] += 1;
    } catch (err) {
      counts.failed += 1;
      console.error(`[agents] schedule of agent ${agent.id} not moved: ${errorLine(err)}`);
    }
  }
  return counts;
}

async function moveOne(agent: LegacyScheduleRow, now: Date): Promise<"moved" | "stopped" | "taken"> {
  // Moved before, and turned back on since (by an older build): it is simply
  // off again, and never moved twice. A routine its creator deleted stays
  // deleted: moving again would bring back what they chose to end (review
  // round 2). Anyone who wants it scheduled sets up a routine in its chat.
  if (agent.scheduleMovedAt) {
    const off = await prisma.agent.updateMany({
      where: { id: agent.id, autonomousEnabled: true, scheduleCron: agent.scheduleCron },
      data: { autonomousEnabled: false, nextRunAt: null },
    });
    if (off.count !== 1) return "taken";
    await auditAgent({
      organizationId: agent.organizationId,
      actorId: null,
      actorType: "system",
      agent: { id: agent.id, name: agent.name, slug: agent.slug },
      action: "schedule_stopped",
      metadata: { routineId: agent.scheduleRoutineId ?? null, reason: "already_moved", schedule: agent.scheduleCron },
    });
    return "stopped";
  }
  const outcome = await legacyScheduleOutcome(agent, now);
  const reason = outcome.kind === "stop" ? outcome.reason : null;
  // The teammate as the old schedule ran it, at the move: a change by
  // someone else after it pauses the routine (review round 10).
  const teammatePrint = outcome.kind === "routine" ? await routineTeammatePrint(agent.organizationId, agent.id) : null;
  const routineId = await prisma.$transaction(async (tx): Promise<string | null | false> => {
    const cas = await tx.agent.updateMany({
      // The instructions too: one an Admin saved meanwhile is moved on the next tick, never lost (review round 3).
      // And never moved: a tick that overlaps another never moves it twice (review round 6).
      where: { id: agent.id, autonomousEnabled: true, scheduleCron: agent.scheduleCron, autonomousPrompt: agent.autonomousPrompt, scheduleMovedAt: null },
      data: { autonomousEnabled: false, nextRunAt: null, scheduleMovedAt: now, scheduleMoveReason: reason },
    });
    if (cas.count !== 1) return false;
    if (outcome.kind !== "routine") return null;
    // A slot the old schedule already had in the future is kept when the
    // schedule is unchanged; a changed one starts at its own next slot.
    const kept = !outcome.changed && agent.nextRunAt && agent.nextRunAt > now ? agent.nextRunAt : null;
    const prompt = clampText((agent.autonomousPrompt ?? "").trim() || LEGACY_COPY.defaultPrompt, ROUTINE_LIMITS.promptMax).trim();
    const row = await tx.agentRoutine.create({
      data: {
        organizationId: agent.organizationId,
        agentId: agent.id,
        actingForId: outcome.actingForId,
        name: LEGACY_COPY.routineName,
        prompt,
        schedule: outcome.schedule,
        status: "active",
        nextRunAt: kept ?? nextRoutineRun(outcome.schedule, now),
        createdVia: "legacy",
        teammatePrint,
      },
      select: { id: true },
    });
    await tx.agent.update({ where: { id: agent.id }, data: { scheduleRoutineId: row.id } });
    return row.id;
  });
  if (routineId === false) return "taken";

  await auditAgent({
    organizationId: agent.organizationId,
    actorId: null,
    actorType: "system",
    agent: { id: agent.id, name: agent.name, slug: agent.slug },
    action: outcome.kind === "routine" ? "schedule_moved" : "schedule_stopped",
    metadata: {
      routineId,
      actingForId: outcome.kind === "routine" ? outcome.actingForId : null,
      reason,
      schedule: outcome.kind === "routine" ? outcome.schedule : agent.scheduleCron,
      changed: outcome.kind === "routine" ? outcome.changed : false,
    },
  });
  if (outcome.kind !== "routine" || !routineId) return "stopped";

  // The creator hears it in their chat with the agent, in their own zone.
  // A notice: the move is done whether or not the line is written.
  try {
    const person = outcome.actingForId;
    const [session, zone, setting] = await Promise.all([
      getOrCreateTeammateSession(agent, person),
      personZone(person, agent.organizationId),
      prisma.agentPersonSetting.findUnique({ where: { agentId_userId: { agentId: agent.id, userId: person } }, select: { approvalRules: true } }).catch(() => null),
    ]);
    const when = wordsInZone(describeSchedule(outcome.schedule, true), scheduleZone(outcome.schedule, serverTimeZone()), zone);
    // A routine honours what the person chose not to be asked about in this
    // chat (Decision 17), so the line says so when they chose any (review round 1).
    const rules = setting?.approvalRules && typeof setting.approvalRules === "object" && !Array.isArray(setting.approvalRules) ? Object.values(setting.approvalRules as Record<string, unknown>) : [];
    const text = rules.includes("always") ? LEGACY_COPY.movedLineKept(agent.name, when) : LEGACY_COPY.movedLine(agent.name, when);
    await writeEventLine(session.id, { text, event: "schedule_moved", routineId });
    publishToUser(person, { type: "agent.changed", agentId: agent.id });
  } catch (err) {
    console.error(`[agents] schedule move line for agent ${agent.id} not written: ${errorLine(err)}`);
  }
  return "moved";
}

// ── Run now ─────────────────────────────────────────────────────────

export interface RunNowResult {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  errorText?: string;
  /** Requests the run left waiting for the clicking person. */
  waiting: number;
  /** Their chat with the agent, where the run's message, answer and cards are. */
  chatHref: string;
}

export type RunNowAnswer =
  | { ok: true; result: RunNowResult }
  | { ok: false; status: number; code: string; error: string; retryAfter?: number };

const chatHrefOf = (slug: string) => `/agents?chat=${encodeURIComponent(slug)}`;

type RunNowRefusal = Extract<RunNowAnswer, { ok: false }>;

const refuse = (status: number, code: string, error: string, retryAfter?: number): RunNowRefusal => ({
  ok: false,
  status,
  code,
  error,
  ...(retryAfter !== undefined ? { retryAfter } : {}),
});

/**
 * Run now for an old Workspace agent: one chat turn of the person who clicks,
 * as themselves, in their own chat with it. Its message is the agent's "What
 * to do each run" (or the old default line), saved as theirs with
 * meta.runNow. The caller has checked the agent is a workspace one and ON.
 */
export async function runLegacyAgentNow(agent: { id: string; slug: string; name: string }, viewer: Viewer): Promise<RunNowAnswer> {
  const started = await startLegacyAgentNow(agent, viewer);
  return started.ok ? started.finish() : started;
}

/**
 * Run now in two parts: everything that can refuse it (the person, the
 * agent, AI set up, the question claimed, the message saved) answers at
 * once; `finish` runs the turn, which takes up to a minute or two. The route
 * answers the refusals with their own status, then keeps the connection
 * alive while the turn runs, so a proxy never cuts a long run short and the
 * page never says it didn't start while it ran (review round 5).
 */
export async function startLegacyAgentNow(
  agent: { id: string; slug: string; name: string },
  viewer: Viewer,
): Promise<RunNowRefusal | { ok: true; runId: string; finish: () => Promise<RunNowAnswer> }> {
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return refuse(403, "person_cannot", ACTION_ERRORS.personCannot);
  const person = acting.person;
  const row = await prisma.agent.findFirst({
    where: { id: agent.id, organizationId: viewer.organizationId },
    select: { ...TEAMMATE_AGENT_SELECT, visibility: true, ownerId: true, autonomousPrompt: true },
  });
  if (!row || !canUseAgent(row, person.viewer)) return refuse(404, "not_found", "Agent not found");
  if (!(await isAiConfigured(viewer.organizationId))) return refuse(503, "not_configured", TEAMMATE_CHAT.notSetUp);

  const session = await getOrCreateTeammateSession(row, person.userId);
  const claim = await claimTeammateTurn({
    organizationId: viewer.organizationId,
    agentId: row.id,
    userId: person.userId,
    what: "AI teammate run now",
    trigger: "CHAT",
    sessionId: session.id,
    routineId: null,
    practice: false,
    rateLimit: true,
  });
  if (!claim.ok) {
    if (claim.code === "rate_limited") return refuse(429, "rate_limited", claim.message, claim.retryAfter ?? 60);
    if (claim.code === "not_found") return refuse(404, "not_found", "Agent not found");
    return refuse(403, claim.code, claim.message);
  }

  const prompt = clampText((row.autonomousPrompt ?? "").trim() || LEGACY_COPY.defaultPrompt, ROUTINE_LIMITS.promptMax).trim();
  let userMessageId: string;
  try {
    const saved = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: prompt, meta: { runNow: true } },
      select: { id: true },
    });
    userMessageId = saved.id;
  } catch (err) {
    console.error(`[agents] run now ${claim.runId} not started: ${errorLine(err)}`);
    await abandonTurn(claim.runId, claim.questionId);
    return refuse(500, "not_saved", TEAMMATE_ROUTE_ERRORS.messageNotSaved);
  }

  return { ok: true, runId: claim.runId, finish: () => finishRunNow({ row, person, sessionId: session.id, prompt, userMessageId, runId: claim.runId, questionId: claim.questionId }) };
}

/** The turn of a Run now that started (startLegacyAgentNow). Never throws. */
async function finishRunNow(a: {
  row: Parameters<typeof teammateAgentFrom>[0];
  person: ActingPerson;
  sessionId: string;
  prompt: string;
  userMessageId: string;
  runId: string;
  questionId: string;
}): Promise<RunNowAnswer> {
  const { row, person, prompt, userMessageId } = a;
  const claim = { runId: a.runId, questionId: a.questionId };
  const session = { id: a.sessionId };
  let turn: TurnResult;
  try {
    turn = await runTeammateTurn({
      agent: teammateAgentFrom(row),
      person,
      sessionId: session.id,
      trigger: "CHAT",
      userText: prompt,
      userMessageId,
      practice: false,
      routine: null,
      runId: claim.runId,
      questionId: claim.questionId,
      streaming: false,
    });
  } catch (err) {
    // runTeammateTurn answers its own failures; this is anything else. What
    // it did is unknown, so its question is kept (the chat route's rule).
    console.error(`[agents] run now ${claim.runId} threw: ${errorLine(err)}`);
    publishToUser(person.userId, { type: "agent.changed", agentId: row.id, runNowDone: true });
    return { ok: true, result: { runId: claim.runId, status: "FAILED", errorText: TURN_ERRORS.noAnswer, waiting: 0, chatHref: chatHrefOf(row.slug) } };
  }
  // Only a turn the model never answered gives its question back (TurnResult.giveBack).
  if (turn.giveBack) await giveBackTurn(claim.runId, claim.questionId);
  // The message, its answer and any card are in the chat now: the person's open tabs re-read it.
  publishToUser(person.userId, { type: "agent.changed", agentId: row.id, runNowDone: true });
  return {
    ok: true,
    result: {
      runId: claim.runId,
      status: turn.error ? "FAILED" : "SUCCEEDED",
      ...(turn.error ? { errorText: turn.error } : {}),
      waiting: turn.proposedActionIds.length,
      chatHref: chatHrefOf(row.slug),
    },
  };
}
