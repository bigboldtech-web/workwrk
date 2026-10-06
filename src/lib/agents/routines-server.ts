// Routines, the server half (docs/plans/ai-teammates.md 3.9 and 3.14):
// saving one, running one (runRoutine: Run now, and the scheduled runner's
// run of a due slot), pausing one, and the scheduled runner itself
// (processDueRoutines, which /api/cron/run-due-agents calls every tick). The
// rules are routines.ts.
//
// A routine works for ONE person, set at creation and never changed: its
// actingForId is the person who asked for it, re-checked on every run, and
// never a fallback to anyone else. It runs at most once an hour (every run
// spends one AI question), and one person has at most ROUTINE_LIMITS of them.
//
// EACH SLOT RUNS AT MOST ONCE. The runner claims a due slot by one
// compare-and-swap on nextRunAt (from the instant it read to the next one),
// so two ticks at once, or a tick retried, find the slot taken and run
// nothing. A slot reached more than ROUTINE_STALE_MS late is skipped as
// missed rather than run hours after its time.
//
// WHAT THE PERSON IS TOLD. A pause writes its line into the chat and one
// Inbox row (agent_routine_paused); a scheduled run that asked them to
// approve something writes one Inbox row (agent_approval) linked to the
// first request's card, so deciding it marks the row read. Every report and
// every pause also tells their open tabs (the realtime event agent.changed).
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { isAiConfigured } from "@/lib/ai-client";
import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import { resolveActingPerson } from "./acting";
import { actionHref, writeEventLine } from "./actions";
import { computeNextRunAt } from "./autonomous";
import { claimTeammateTurn, giveBackTurn } from "./budget";
import { splitScheduleZone } from "./cron";
import { TEAMMATE_AGENT_SELECT, getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom } from "./engine";
import { ROUTINE_LIMITS, ROUTINE_REASON_TEXT, ROUTINE_STALE_MS, routineReasonForPerson, routineScheduleProblem, type RoutineReason } from "./routines";
import { describeSchedule, wordsInZone } from "./schedule-words";
import { canUseAgent } from "./teammate-access";
import {
  APPROVAL_CARD,
  TEAMMATE_CHAT,
  TEAMMATE_ERRORS,
  approvalNoticeMessage,
  approvalNoticeTitle,
  routineLimitMessage,
  routinePausedLine,
  routinePausedNoticeMessage,
  routinePausedNoticeTitle,
  routineSkippedLine,
} from "./teammate-copy";
import { actionViewFromRow } from "./teammate-thread";
import { clampText } from "./clamp";

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/** Tell the person's open tabs that a teammate's chat changed (realtime-events.ts agent.changed). */
function agentChanged(userId: string, agentId: string): void {
  publishToUser(userId, { type: "agent.changed", agentId });
}

/** Where a paused routine's Inbox row opens: the teammate's chat, with its routines. */
export function routinesHref(agentSlug: string): string {
  return `/agents?chat=${encodeURIComponent(agentSlug)}&settings=routines`;
}

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

/** The person's live chat with the routine's teammate, where its lines go; null before they have one. */
async function routineChatId(r: PausableRoutine): Promise<string | null> {
  const chat = await prisma.chatSession.findFirst({
    where: { organizationId: r.organizationId, agentId: r.agentId, userId: r.actingForId, kind: "TEAMMATE", archivedAt: null },
    select: { id: true },
  });
  return chat?.id ?? null;
}

/**
 * Pause a routine for a reason (3.9): status paused with the reason kept, no
 * next run, the line "Routine paused: {name}. {reason}" in its person's chat
 * with the teammate, and one Inbox row (agent_routine_paused) linked to the
 * chat's routines. One swap from active, so a routine paused twice at once
 * writes one line and one row. Only its person resumes it (PATCH
 * /api/agents/routines/[id]). `agent` names the teammate when the caller
 * already holds it; else it is read. True when this call paused it.
 */
export async function pauseRoutine(r: PausableRoutine, reason: RoutineReason, agent?: { name: string; slug: string } | null): Promise<boolean> {
  const paused = await prisma.agentRoutine.updateMany({
    where: { id: r.id, status: "active" },
    data: { status: "paused", pausedReason: reason, nextRunAt: null },
  });
  if (paused.count !== 1) return false;
  const why = ROUTINE_REASON_TEXT[reason];
  await writeEventLine(await routineChatId(r), { text: routinePausedLine(r.name, why), event: "routine_paused", routineId: r.id });
  const named = agent ?? (await prisma.agent.findFirst({ where: { id: r.agentId, organizationId: r.organizationId }, select: { name: true, slug: true } }));
  if (named) {
    try {
      await prisma.notification.create({
        data: {
          userId: r.actingForId,
          type: "agent_routine_paused",
          title: routinePausedNoticeTitle(named.name),
          message: routinePausedNoticeMessage(r.name, why),
          link: routinesHref(named.slug),
        },
      });
      publishToUser(r.actingForId, { type: "notification" });
    } catch (err) {
      // A notice: the pause stands without it, and its line is in the chat.
      console.error(`[agents] routine ${r.id} pause notice not written: ${errorLine(err)}`);
    }
  }
  agentChanged(r.actingForId, r.agentId);
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
  // Its report, and any card, are in the chat now: the person's open tabs re-read it.
  agentChanged(person.userId, agent.id);
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

// ── The scheduled runner ────────────────────────────────────────────

/** What the runner reads of a due routine: what a run reads, its slot, and how its last slot went. */
const DUE_SELECT = { ...ROUTINE_RUN_SELECT, nextRunAt: true, lastRunAt: true, lastReason: true } as const;

type DueRoutineRow = Prisma.AgentRoutineGetPayload<{ select: typeof DUE_SELECT }>;

/** What one tick of the runner did, in counts only: no workspace, teammate or person is named. */
export interface DueRoutineCounts {
  /** Due when the tick looked (at most `limit`). */
  due: number;
  /** Ran and reported. */
  succeeded: number;
  /** Ran but ended early or never got an answer, or the run threw. */
  failed: number;
  /** Not run, for a reason that skips this one slot (the routine runs at its next). */
  skipped: number;
  /** Reached more than ROUTINE_STALE_MS after its time: skipped as missed. */
  missed: number;
  /** Not run, for a reason that pauses the routine until its person resumes it. */
  paused: number;
  /** Another tick claimed the slot first, or the routine changed since it was read. */
  taken: number;
  /** Not started: the tick's budget ran out first. Still due, so the next tick runs them. */
  deferred: number;
}

/**
 * Run the routines that are due (3.9), oldest slot first: at most `limit`
 * per tick, `concurrency` at a time, and none started once `budgetMs` has
 * passed (the cron's later steps need the rest of its time). Each slot is
 * claimed by one compare-and-swap on nextRunAt, then run through runRoutine
 * as its person, then paused or skipped as runRoutine's refusal says.
 */
export async function processDueRoutines(
  now: Date,
  opts: { limit: number; budgetMs: number; concurrency: number },
): Promise<DueRoutineCounts> {
  const started = Date.now();
  const due = await prisma.agentRoutine.findMany({
    where: { status: "active", nextRunAt: { lte: now } },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: opts.limit,
    select: DUE_SELECT,
  });
  const counts: DueRoutineCounts = { due: due.length, succeeded: 0, failed: 0, skipped: 0, missed: 0, paused: 0, taken: 0, deferred: 0 };
  const queue = [...due];
  const work = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      if (Date.now() - started >= opts.budgetMs) {
        // Past the budget: nothing more starts. What is left stays due, and
        // the next tick takes it well inside ROUTINE_STALE_MS.
        counts.deferred += 1 + queue.length;
        queue.length = 0;
        return;
      }
      try {
        await runDueSlot(r, now, counts);
      } catch (err) {
        counts.failed += 1;
        console.error(`[agents] routine ${r.id} failed: ${errorLine(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, queue.length)) }, work));
  return counts;
}

async function runDueSlot(r: DueRoutineRow, now: Date, counts: DueRoutineCounts): Promise<void> {
  const dueAt = r.nextRunAt;
  if (!dueAt) return;
  // Claim the slot: move nextRunAt on from the very instant read. Only one
  // caller can move it from that value, so the slot runs at most once.
  const claimed = await prisma.agentRoutine.updateMany({
    where: { id: r.id, status: "active", nextRunAt: dueAt },
    data: { nextRunAt: computeNextRunAt(r.schedule, now) },
  });
  if (claimed.count !== 1) {
    counts.taken += 1;
    return;
  }
  if (now.getTime() - dueAt.getTime() > ROUTINE_STALE_MS) {
    counts.missed += 1;
    await recordSkip(r, "missed", now);
    return;
  }

  const run = await runRoutine(r, { practice: false, rateLimit: false, dueAt });
  if (!run.ok) {
    // rate_limited is Run now's alone: this runner claims without the
    // per-minute limit. Should it ever come back, the slot is skipped.
    if (run.reason === "rate_limited") {
      counts.skipped += 1;
      return;
    }
    if (run.pause) {
      // False when its person paused it a moment ago: then it stays theirs.
      if (await pauseRoutine(r, run.reason)) counts.paused += 1;
      else counts.skipped += 1;
      return;
    }
    counts.skipped += 1;
    await recordSkip(r, run.reason, now);
    return;
  }
  if (run.status === "SUCCEEDED") counts.succeeded += 1;
  else counts.failed += 1;
  if (run.proposedActionIds.length > 0) await noticeApprovals(run, r.name);
}

/**
 * A slot that did not run: the routine records why (lastStatus SKIPPED with
 * the reason, at the tick's time, and no run) and runs again at its next
 * slot. Only the teammate's monthly limit says so in the chat, and once a
 * month: whoever manages the teammate can raise it, and the line would
 * otherwise come back every slot until the month turns. The other reasons
 * are the workspace's or a manager's (AI off, the teammate paused, AI not
 * set up), or a late scheduler, and stay on the routine.
 */
async function recordSkip(r: DueRoutineRow, reason: RoutineReason, now: Date): Promise<void> {
  await prisma.agentRoutine
    .updateMany({ where: { id: r.id }, data: { lastRunAt: now, lastRunId: null, lastStatus: "SKIPPED", lastReason: reason } })
    .catch((err) => console.error(`[agents] routine ${r.id} skip not recorded: ${errorLine(err)}`));
  if (reason !== "agent_cap") return;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (r.lastReason === "agent_cap" && r.lastRunAt && r.lastRunAt.getTime() >= monthStart) return;
  const line = await writeEventLine(await routineChatId(r), {
    text: routineSkippedLine(r.name, ROUTINE_REASON_TEXT.agent_cap),
    event: "routine_skipped",
    routineId: r.id,
  });
  if (line) agentChanged(r.actingForId, r.agentId);
}

/**
 * One Inbox row for a scheduled run that asked its person to approve
 * something (3.14), linked to the first request's card (actions.ts
 * actionHref), so deciding that request, or its expiry, marks the row read.
 * A chat's own requests write none: the person is in the chat, and the AI
 * sidebar's count covers a card they leave.
 */
async function noticeApprovals(run: RoutineRun, routineName: string): Promise<void> {
  const firstId = run.proposedActionIds[0];
  try {
    const first = await prisma.agentAction.findFirst({
      where: { id: firstId, actingForId: run.personId },
      select: { id: true, toolName: true, risk: true, status: true, preview: true, createdAt: true, expiresAt: true },
    });
    const title = first ? actionViewFromRow(first).preview.title : APPROVAL_CARD.untitled;
    await prisma.notification.create({
      data: {
        userId: run.personId,
        type: "agent_approval",
        title: approvalNoticeTitle(run.agent.name),
        message: approvalNoticeMessage(run.proposedActionIds.length, routineName, title),
        link: actionHref(run.agent.slug, firstId),
      },
    });
    publishToUser(run.personId, { type: "notification" });
  } catch (err) {
    // A notice: the requests wait on their cards, and the AI sidebar counts them.
    console.error(`[agents] approval notice for run ${run.runId} not written: ${errorLine(err)}`);
  }
}
