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
import { nextCronRun, parseCron, splitScheduleZone } from "./cron";
import { TEAMMATE_AGENT_SELECT, getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom } from "./engine";
import { ROUTINE_LIMITS, ROUTINE_REASON_TEXT, ROUTINE_STALE_MS, routineReasonForPerson, routineScheduleProblem, type RoutineReason } from "./routines";
import { describeSchedule, wordsInZone } from "./schedule-words";
import { canUseAgent } from "./teammate-access";
import { othersMayChange, teammateFingerprint } from "./teammate-print";
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
  // The teammate as its person chooses it now: one changed by someone else
  // later pauses the routine (review round 10).
  const teammatePrint = await routineTeammatePrint(a.organizationId, a.agentId);
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
      teammatePrint,
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

/** A routine's teammate as it is now, as a fingerprint (teammate-print.ts), or null when it can't be read. */
export async function routineTeammatePrint(organizationId: string, agentId: string): Promise<string | null> {
  const agent = await prisma.agent
    .findFirst({ where: { id: agentId, organizationId }, select: { name: true, description: true, systemPrompt: true, toolNames: true, approvalRules: true, modelOverride: true, productSlug: true } })
    .catch(() => null);
  return agent ? teammateFingerprint(agent) : null;
}

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
  teammatePrint: true,
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
 *   someone else may have changed it      pause   teammate_changed (Run now pauses too)
 *   AI isn't set up                       skip    not_configured
 *   the teammate's month is used          skip    agent_cap
 *   the plan's questions are used         pause   out_of_questions
 *   the person's free questions are used  pause   person_free_used
 *   free AI's ceiling for the day         skip    free_ai_day (back tomorrow, UTC)
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
  // A teammate someone else may change runs unattended as this person only
  // as it was when they last chose it: one changed since (or a routine made
  // before such changes were checked) pauses, with its reason (review round 10).
  if (othersMayChange(agent, r.actingForId) && r.teammatePrint !== teammateFingerprint(agent)) return refusal("teammate_changed", true);
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
    if (claim.code === "ai_limit") {
      // Only what does not come back by itself pauses: the day's free ceiling
      // returns at 00:00 UTC, so that run is skipped and the next one runs.
      if (claim.refusedBy === "free_day") return refusal("free_ai_day", false, claim.message);
      if (claim.refusedBy === "person") return refusal("person_free_used", true, claim.message);
      return refusal("out_of_questions", true, claim.message);
    }
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
  // Only a turn the model never answered gives its question back; a refused,
  // cut or empty answer was made and billed, and keeps it (TurnResult.giveBack).
  if (turn.giveBack) await giveBackTurn(claim.runId, claim.questionId);
  const status = turn.error ? "FAILED" : "SUCCEEDED";
  const reason: RoutineReason | null = turn.giveBack ? "ai_failed" : turn.failedBeforeAnything ? "no_answer" : null;
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
  /** Due when the tick looked: the late slots (up to MISSED_PER_TICK) and the timely ones (up to `limit`). */
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

/** Slots already past ROUTINE_STALE_MS cleared per tick: each is two writes and no AI. */
export const MISSED_PER_TICK = 1000;

/**
 * The slots due now and still on time, at most `limit`, picked in turn
 * across workspaces in SQL: each workspace's oldest, then each one's second
 * oldest, and so on, over every due slot, so one large workspace's 9:00
 * routines never hold every other workspace's places (review rounds 10 and
 * 11: a pick over only the oldest few hundred did not). The times go in as
 * UTC text: nextRunAt has no time zone, and the database's own may not be UTC.
 */
async function pickDueFairly(now: Date, staleBefore: Date, limit: number): Promise<DueRoutineRow[]> {
  const picked = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT d."id" FROM (
      SELECT "id", "nextRunAt", row_number() OVER (PARTITION BY "organizationId" ORDER BY "nextRunAt", "id") AS rn
      FROM "AgentRoutine"
      WHERE "status" = 'active'
        AND "nextRunAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND "nextRunAt" >= (${staleBefore.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    ) d
    WHERE d.rn <= ${limit}
    ORDER BY d.rn, d."nextRunAt", d."id"
    LIMIT ${limit}`;
  if (picked.length === 0) return [];
  // The same window again: a slot another tick claimed (or its person
  // rescheduled) between the two reads has moved, and is left alone, never
  // claimed at its new time and run now (review round 12).
  const rows = await prisma.agentRoutine.findMany({
    where: { id: { in: picked.map((p) => p.id) }, status: "active", nextRunAt: { gte: staleBefore, lte: now } },
    select: DUE_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return picked.map((p) => byId.get(p.id)).filter((r): r is DueRoutineRow => Boolean(r));
}

/**
 * Run the routines that are due (3.9). First the slots already more than
 * ROUTINE_STALE_MS late, up to MISSED_PER_TICK: each is recorded as missed
 * and moved on, running nothing, so a backlog (the cron down for an
 * afternoon) never holds the places of slots still on time (review round
 * 11). Then the timely ones, at most `limit`, picked fairly across
 * workspaces (pickDueFairly). Both `concurrency` at a time, none started
 * once `budgetMs` has passed (the cron's later steps need the rest of its
 * time); what is left stays due for the next tick. Each slot is claimed by
 * one compare-and-swap on nextRunAt, then run through runRoutine as its
 * person, then paused or skipped as runRoutine's refusal says.
 */
export async function processDueRoutines(
  now: Date,
  opts: { limit: number; budgetMs: number; concurrency: number },
): Promise<DueRoutineCounts> {
  const started = Date.now();
  const staleBefore = new Date(now.getTime() - ROUTINE_STALE_MS);
  const counts: DueRoutineCounts = { due: 0, succeeded: 0, failed: 0, skipped: 0, missed: 0, paused: 0, taken: 0, deferred: 0 };
  const drain = async (queue: DueRoutineRow[]) => {
    const work = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        if (Date.now() - started >= opts.budgetMs) {
          // Past the budget: nothing more starts. What is left stays due for the next tick.
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
  };
  const late = await prisma.agentRoutine.findMany({
    where: { status: "active", nextRunAt: { lt: staleBefore } },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: MISSED_PER_TICK,
    select: DUE_SELECT,
  });
  counts.due += late.length;
  await drain([...late]);
  const due = await pickDueFairly(now, staleBefore, opts.limit);
  counts.due += due.length;
  await drain([...due]);
  return counts;
}

/**
 * A routine's next slot: its cron's next minute (null when the cron names
 * none in the next year), else the interval's (hourly, every N hours).
 * computeNextRunAt alone falls back to an hour from now for a cron with no
 * next minute, which would run such a routine every hour.
 */
export function nextRoutineRun(schedule: string, now: Date): Date | null {
  return parseCron(schedule) ? nextCronRun(schedule, now) : computeNextRunAt(schedule, now);
}

async function runDueSlot(r: DueRoutineRow, now: Date, counts: DueRoutineCounts): Promise<void> {
  const dueAt = r.nextRunAt;
  if (!dueAt) return;
  const next = nextRoutineRun(r.schedule, now);
  // Claim the slot: move nextRunAt on from the very instant read. Only one
  // caller can move it from that value, so the slot runs at most once.
  const claimed = await prisma.agentRoutine.updateMany({
    where: { id: r.id, status: "active", nextRunAt: dueAt },
    data: { nextRunAt: next },
  });
  if (claimed.count !== 1) {
    counts.taken += 1;
    return;
  }
  // No later time comes within a year. The slot due now still runs when it
  // is a real time of the schedule (a leap day's 29 February, review round
  // 2); a slot the old hourly fallback stored is no time of its cron and does
  // not. Either way it then pauses with the reason, and never runs every hour
  // (review round 1). nextRunAt is already null, so the slot cannot run twice.
  const last = !next;
  if (last && !isSlotOf(r.schedule, dueAt)) {
    counts.paused += 1;
    await pauseRoutine(r, "no_next_run");
    return;
  }
  if (now.getTime() - dueAt.getTime() > ROUTINE_STALE_MS) {
    counts.missed += 1;
    await recordSkip(r, "missed", now);
  } else if (await runClaimedSlot(r, now, dueAt, counts)) {
    return;
  }
  if (last) {
    counts.paused += 1;
    await pauseRoutine(r, "no_next_run");
  }
}

/** Whether `at` is a time the schedule names (its cron's next minute after the one before). */
function isSlotOf(schedule: string, at: Date): boolean {
  return Boolean(parseCron(schedule)) && nextCronRun(schedule, new Date(at.getTime() - 60_000))?.getTime() === at.getTime();
}

/** Run a claimed, timely slot; true when the run paused the routine. */
async function runClaimedSlot(r: DueRoutineRow, now: Date, dueAt: Date, counts: DueRoutineCounts): Promise<boolean> {
  const run = await runRoutine(r, { practice: false, rateLimit: false, dueAt });
  if (!run.ok) {
    // rate_limited is Run now's alone: this runner claims without the
    // per-minute limit. Should it ever come back, the slot is skipped.
    if (run.reason === "rate_limited") {
      counts.skipped += 1;
      return false;
    }
    if (run.pause) {
      // False when its person paused it a moment ago: then it stays theirs.
      if (await pauseRoutine(r, run.reason)) counts.paused += 1;
      else counts.skipped += 1;
      return true;
    }
    counts.skipped += 1;
    await recordSkip(r, run.reason, now);
    return false;
  }
  if (run.status === "SUCCEEDED") counts.succeeded += 1;
  else counts.failed += 1;
  if (run.proposedActionIds.length > 0) await noticeApprovals(run, r.name);
  return false;
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
