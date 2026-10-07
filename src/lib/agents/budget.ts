// An AI teammate's AI questions (docs/plans/ai-teammates.md 3.12).
//
// ONE TURN IS ONE AI QUESTION: a chat message, a continue after approvals, a
// routine run or a practice run, however many model calls the turn makes,
// exactly as one Ask AI message is one question. An approval is not a turn:
// it runs the one action the person approved and asks the model nothing.
//
// TWO LIMITS, ONE TRANSACTION. A teammate may have its own monthly limit
// (Agent.monthlyQuestionCap), on top of the plan's allowance and never
// instead of it. claimTeammateTurn locks the teammate's row and
// counts the questions its turns kept this month; at the limit it claims
// nothing at all. Under the limit it claims the plan's question
// (claimAiQuestionIn: the plan's cap, the free questions per person and the
// platform's free ceiling, under the workspace's row lock) and records the
// turn's AgentRun with that question's id, all or nothing. Two turns at once
// count one after the other, so neither limit can be passed by racing it.
// The locks are always taken Agent first, then AutomationWorkflow (an
// automation's step), then Organization. The Agent and AutomationWorkflow
// rows are taken FOR NO KEY UPDATE: two claims still wait for each other,
// but an insert that refers to the row (a group's members, an automation's
// run), whose key check takes KEY SHARE, never does. FOR UPDATE made such an
// insert and a claim wait on each other's locks in turn, and Postgres
// cancelled one (review round 3).
//
// ONLY KEPT QUESTIONS COUNT. A turn that failed before anything happened
// gives its question back (giveBackTurn): the AIQuery row is deleted and
// AgentRun.questionId cleared, so the month's count (questionId not null)
// stops counting it as well.
//
// THE MONTH IS A UTC CALENDAR MONTH, its start taken in SQL from the
// database's clock in UTC, the clock every stored time is written in.
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { AI_ACTIONS_PER_MINUTE, aiRateLimitMessage, claimAiQuestionIn, releaseAiQuestion } from "@/lib/ai-allowance";
import { rateLimit } from "@/lib/rate-limit-memory";
import { ROUTINE_REASON_TEXT } from "./routines";
import { AUTOMATION_TEAMMATE_COPY, TURN_ERRORS, agentCapMessage } from "./teammate-copy";
import type { TeammateToolContext } from "./tools";

export { agentCapMessage };

/** What starts a teammate's turn: a chat message, a continue after approvals, or a routine. */
export type TurnTrigger = Exclude<TeammateToolContext["trigger"], "APPROVAL">;

export type TurnClaim =
  | { ok: true; runId: string; questionId: string }
  | {
      ok: false;
      /** not_found: the teammate's row is gone (its workspace was deleted under the turn). */
      /** workflow_cap: an automation asked its teammates its most for the UTC day (Phase 2 step 7). */
      code: "rate_limited" | "agent_cap" | "ai_limit" | "not_found" | "workflow_cap";
      message: string;
      retryAfter?: number;
      /** For ai_limit: which bound refused (AiClaim.refusedBy). */
      refusedBy?: "plan" | "person" | "free_day";
    };

type Db = Pick<typeof prisma, "$queryRaw">;

/** The first day of the UTC month of `at`. */
function utcMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/**
 * The questions this teammate's turns kept in the current UTC month, and the
 * month's first day, both from one statement on the database's clock. The
 * day comes back as text, so no driver can read it in another zone.
 */
async function monthUsageIn(db: Db, agentId: string): Promise<{ used: number; monthStart: Date }> {
  const rows = await db.$queryRaw<Array<{ used: number; month: string | null }>>`
    SELECT COUNT(*)::int AS "used", (date_trunc('month', now() AT TIME ZONE 'UTC'))::date::text AS "month"
    FROM "AgentRun"
    WHERE "agentId" = ${agentId} AND "questionId" IS NOT NULL
      AND "startedAt" >= date_trunc('month', now() AT TIME ZONE 'UTC')`;
  const month = rows[0]?.month ? new Date(`${rows[0].month}T00:00:00Z`) : null;
  return {
    used: Number(rows[0]?.used ?? 0),
    monthStart: month && !Number.isNaN(month.getTime()) ? month : utcMonthStart(new Date()),
  };
}

/** What a teammate has used this UTC month: the drawer's usage line and the activity tab. */
export async function agentMonthUsage(agentId: string): Promise<{ used: number; monthStart: Date }> {
  return monthUsageIn(prisma, agentId);
}

/**
 * Claim one AI question for one turn of a teammate, and record the turn's
 * AgentRun (PENDING) with the question it holds. `rateLimit` (a chat message,
 * a continue, Run now) first holds the person to Ask AI's per-minute limit,
 * the same counter Ask AI uses; a scheduled routine run skips it. `what`
 * names the action for the AIQuery record ("AI teammate message"), never
 * the person's own words: the row outlives the chat.
 */
export async function claimTeammateTurn(a: {
  organizationId: string;
  agentId: string;
  userId: string;
  what: string;
  trigger: TurnTrigger;
  sessionId: string | null;
  routineId: string | null;
  practice: boolean;
  rateLimit: boolean;
  /** Phase 2: the caller's turn when another teammate asked for this one (ask_teammate). */
  parentRunId?: string | null;
  /** Phase 2 step 7: the automation run that asked, held to its own daily cap. */
  workflow?: { id: string; runId: string; dailyCap: number } | null;
}): Promise<TurnClaim> {
  if (a.rateLimit) {
    const limited = rateLimit(`ai:${a.userId}`, { max: AI_ACTIONS_PER_MINUTE, windowMs: 60_000 });
    if (!limited.ok) return { ok: false, code: "rate_limited", message: aiRateLimitMessage(limited.retryAfter), retryAfter: limited.retryAfter };
  }
  return prisma.$transaction(async (tx): Promise<TurnClaim> => {
    // The teammate's row first: a second turn at once waits here, then
    // counts this one's run.
    const agents = await tx.$queryRaw<Array<{ name: string; cap: number | null }>>`
      SELECT "name", "monthlyQuestionCap" AS "cap" FROM "Agent"
      WHERE "id" = ${a.agentId} AND "organizationId" = ${a.organizationId}
      FOR NO KEY UPDATE`;
    if (agents.length === 0) return { ok: false, code: "not_found", message: ROUTINE_REASON_TEXT.agent_removed };
    const cap = agents[0].cap;
    if (cap !== null && cap !== undefined) {
      const usage = await monthUsageIn(tx, a.agentId);
      if (usage.used >= cap) return { ok: false, code: "agent_cap", message: agentCapMessage(agents[0].name, cap, usage.monthStart) };
    }
    // An automation's own daily cap, counted under its row (lock order:
    // Agent, then AutomationWorkflow, then the plan's rows in the claim), so
    // two runs at once cannot both take the last one. Only runs that hold a
    // question count: a run whose question was given back did not ask.
    if (a.workflow) {
      const wf = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationWorkflow"
        WHERE "id" = ${a.workflow.id} AND "organizationId" = ${a.organizationId}
        FOR NO KEY UPDATE`;
      if (wf.length === 0) return { ok: false, code: "not_found", message: AUTOMATION_TEAMMATE_COPY.workflowGone };
      const [{ used }] = await tx.$queryRaw<Array<{ used: number }>>`
        SELECT COUNT(*)::int AS "used" FROM "AgentRun"
        WHERE "automationWorkflowId" = ${a.workflow.id}
          AND "questionId" IS NOT NULL
          AND "startedAt" >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
      if (used >= a.workflow.dailyCap) return { ok: false, code: "workflow_cap", message: AUTOMATION_TEAMMATE_COPY.dailyCap(a.workflow.dailyCap) };
    }
    const question = await claimAiQuestionIn(tx, a.organizationId, a.userId, a.what);
    if (!question.ok) return { ok: false, code: "ai_limit", message: question.message, ...(question.refusedBy ? { refusedBy: question.refusedBy } : {}) };
    const run = await tx.agentRun.create({
      data: {
        agentId: a.agentId,
        triggeredBy: a.userId,
        actingForId: a.userId,
        sessionId: a.sessionId,
        routineId: a.routineId,
        questionId: question.id,
        status: "PENDING",
        ...(a.parentRunId ? { parentRunId: a.parentRunId } : {}),
        ...(a.workflow ? { automationWorkflowId: a.workflow.id, automationRunId: a.workflow.runId } : {}),
        input: { trigger: a.trigger, practice: a.practice, routineId: a.routineId, ...(a.parentRunId ? { parentRunId: a.parentRunId } : {}) },
      },
      select: { id: true },
    });
    return { ok: true, runId: run.id, questionId: question.id };
  });
}

/**
 * A teammate run still open this long after it started never finished: its
 * process stopped mid-turn. Wide on purpose: a turn makes up to 8 model calls
 * and may ask 3 other teammates, each a turn of its own, so a slow AI service
 * can keep a live one going for most of an hour (review round 6).
 */
export const RUN_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * A turn whose process stopped (a restart, out of memory, a cut connection
 * that took the server with it) leaves its run PENDING, read as "Running
 * now" in Run history for good. Each tick, one open past RUN_STALE_MS
 * becomes FAILED with that said. Its question is kept: what the turn did
 * before it stopped is unknown, which is the chat route's rule for a turn
 * that threw (review round 5). Old Workspace agents runs left RUNNING by the
 * loop Phase 2 removed are closed the same way.
 */
export async function sweepStaleRuns(now: Date = new Date()): Promise<number> {
  const stale = await prisma.agentRun.updateMany({
    where: { status: { in: ["PENDING", "RUNNING"] }, startedAt: { lt: new Date(now.getTime() - RUN_STALE_MS) } },
    data: { status: "FAILED", endedAt: now, error: TURN_ERRORS.didntFinish },
  });
  return stale.count;
}

/**
 * Give a turn's question back: the turn failed before any text or any tool
 * ran (Ask AI's rule). The question goes back to the plan's allowance, with
 * the day's free use it took, and the run stops counting toward the
 * teammate's month. Never throws: it runs on a path that is already failing.
 */
export async function giveBackTurn(runId: string, questionId: string): Promise<void> {
  await releaseAiQuestion(questionId);
  await prisma.agentRun.updateMany({ where: { id: runId, questionId }, data: { questionId: null } }).catch(() => {});
}

/**
 * A turn that never started after its question was claimed: the question
 * goes back, and its AgentRun goes with it, so the run history never shows a
 * turn that did not run. Never throws.
 */
export async function abandonTurn(runId: string, questionId: string): Promise<void> {
  await giveBackTurn(runId, questionId);
  await prisma.agentRun.deleteMany({ where: { id: runId, questionId: null } }).catch(() => {});
}
