// The words of a person's AI teammates and AI chats, blanked after their
// account erasure (POST /api/me/delete; review round 5 of Phase 3).
//
// TWO PARTS. The erasure's own transaction is short: the workspace locks, the
// last-admin re-check, the person's open runs and running requests failed,
// their User row anonymised, a few small deletes and the consent record.
// Before, it also blanked their whole teammate history in that one 20 second
// transaction, so a person with 30 hourly routines (about 260,000 runs and
// report rows a year) timed it out every time and could never erase their
// account, and their teammates' answers in flight were lost while it held
// their runs. Now, after it commits, blankTeammateHistory blanks what is left
// in batches of ERASURE_BATCH rows, each its own short statement, within a
// budget; finishErasures, a step of the teammates cron, finishes whatever the
// budget left, and anything written late.
//
// WHY AFTER THE COMMIT IS SAFE. From the erasure's commit on, budget.ts
// runState reads every run of theirs as closed or person_gone, so no
// teammate turn of theirs writes again; a turn that saved before the commit
// has its rows blanked here. Their sessions ended with the commit too
// (tokenVersion), so only a request already in flight at that moment (an Ask
// AI answer still streaming, a click in another tab) can still write, and
// the sweep reads them again for ERASURE_SETTLED_MS before it records the
// erasure finished.
//
// WHAT "STILL HOLDING WORDS" IS, exactly what the erasure blanks:
//   - a chat message of a chat they own whose content is not "Erased", or
//     with a call record or meta (ChatMessage, by (sessionId, createdAt));
//   - a chat of theirs with a title;
//   - a request they were asked to approve with any input, edited input,
//     preview, result or error (AgentAction, by actingForId);
//   - a run of theirs with output, and an Ask AI tool run with input or an
//     error (AgentRun, by ("triggeredBy", "id"), prisma/sql
//     2026-10-10-ai-teammates-phase3-round5.sql). Every run that acts for a
//     person was claimed by them (budget.ts claimTeammateTurn writes
//     triggeredBy and actingForId alike), so triggeredBy finds every one;
//   - an AI question of theirs not worded "Erased", or with a response
//     (AIQuery), and the network details on the activity rows they authored
//     (ActivityLog). Both grow by one row a teammate turn or write, so they
//     left the erasure's transaction too. Neither table has an index that
//     orders one person's rows, so each is one statement that reads their
//     rows and writes only those still holding words; the questions of their
//     teammates' turns are blanked with each batch of runs first, by id;
//   - what their teammates remember about them, and their routines' words,
//     which a tool may have saved in the instant before the commit.
// Each batch starts where the last stopped (the last row's createdAt and id,
// or id), so no batch reads again a row an earlier one blanked. Every part is
// the same update the erasure made before, split; no row is deleted but the
// memories, as before.
//
// FINISHED. A pass that found nothing left, for an erasure older than
// ERASURE_SETTLED_MS, writes one ConsentRecord (method ERASURE_FINISHED_METHOD),
// evidence of when the erasure ended, and the sweep reads that person no
// more. So a finished person costs nothing, and an unfinished one is never
// pushed out by those already done.
//
// Server-only: imports prisma.

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { RUN_STALE_MS } from "./budget";

/** Rows one statement blanks at most. */
export const ERASURE_BATCH = 500;

/** How long the erasure's own request spends blanking after its commit; the sweep finishes the rest. */
export const ERASURE_INLINE_BUDGET_MS = 20_000;

/** How far back the sweep looks for erasures it has not finished. */
export const ERASURE_SWEEP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long after an erasure a request already in flight at its commit could
 * still write: as long as budget.ts gives a live turn. Only after this does a
 * clean pass finish the erasure.
 */
export const ERASURE_SETTLED_MS = RUN_STALE_MS;

/** The erasure's own consent record (POST /api/me/delete), and the one that says it finished. */
export const ERASURE_METHOD = "erasure";
export const ERASURE_FINISHED_METHOD = "erasure_finished";

/** What a blanked text reads. */
const ERASED = "Erased";

const MESSAGE_WORDS: Prisma.ChatMessageWhereInput = {
  OR: [{ content: { not: ERASED } }, { toolCalls: { not: Prisma.DbNull } }, { meta: { not: Prisma.DbNull } }],
};
const REQUEST_WORDS: Prisma.AgentActionWhereInput = {
  OR: [
    { input: { not: {} } },
    { editedInput: { not: Prisma.DbNull } },
    { preview: { not: {} } },
    { result: { not: Prisma.DbNull } },
    { error: { not: null } },
  ],
};
// Ask AI's tool runs (no actingForId) keep the tool's input, and an error
// that can quote it; a teammate run's error is one of the engine's own
// sentences (TURN_ERRORS), so it stays, as before.
const RUN_WORDS: Prisma.AgentRunWhereInput = {
  OR: [{ output: { not: Prisma.DbNull } }, { actingForId: null, OR: [{ input: { not: {} } }, { error: { not: null } }] }],
};
const QUESTION_WORDS: Prisma.AIQueryWhereInput = { OR: [{ query: { not: ERASED } }, { response: { not: null } }] };
const ROUTINE_WORDS: Prisma.AgentRoutineWhereInput = {
  OR: [{ name: { not: ERASED } }, { prompt: { not: ERASED } }, { status: { not: "paused" } }, { nextRunAt: { not: null } }],
};

/** One pass: whether it reached the end, and how many rows it blanked. */
export interface ErasurePass {
  done: boolean;
  rows: number;
}

/** Rows after this one in (createdAt, id) order, for an index on createdAt. */
function after(c: { createdAt: Date; id: string } | null) {
  return c ? [{ createdAt: { gte: c.createdAt }, OR: [{ createdAt: { gt: c.createdAt } }, { id: { gt: c.id } }] }] : [];
}

/** One chat's messages still holding words, in (createdAt, id) order. */
async function blankMessagesOf(sessionId: string, deadline: number): Promise<ErasurePass> {
  let rows = 0;
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    if (Date.now() >= deadline) return { done: false, rows };
    const batch: Array<{ id: string; createdAt: Date }> = await prisma.chatMessage.findMany({
      where: { sessionId, AND: [MESSAGE_WORDS, ...after(cursor)] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ERASURE_BATCH,
      select: { id: true, createdAt: true },
    });
    if (batch.length > 0) {
      await prisma.chatMessage.updateMany({ where: { id: { in: batch.map((m) => m.id) } }, data: { content: ERASED, toolCalls: Prisma.DbNull, meta: Prisma.DbNull } });
      rows += batch.length;
    }
    if (batch.length < ERASURE_BATCH) return { done: true, rows };
    cursor = batch[batch.length - 1];
  }
}

/** Every chat they own, with Ask AI or a teammate, in every workspace: its messages, then its title. */
async function blankChats(userId: string, deadline: number): Promise<ErasurePass> {
  let rows = 0;
  let last: string | null = null;
  for (;;) {
    if (Date.now() >= deadline) return { done: false, rows };
    const chats: Array<{ id: string }> = await prisma.chatSession.findMany({
      where: { userId, ...(last ? { id: { gt: last } } : {}) },
      orderBy: { id: "asc" },
      take: ERASURE_BATCH,
      select: { id: true },
    });
    for (const c of chats) {
      const pass = await blankMessagesOf(c.id, deadline);
      rows += pass.rows;
      if (!pass.done) return { done: false, rows };
    }
    if (chats.length > 0) {
      const titled = await prisma.chatSession.updateMany({ where: { id: { in: chats.map((c) => c.id) }, title: { not: null } }, data: { title: null } });
      rows += titled.count;
    }
    if (chats.length < ERASURE_BATCH) return { done: true, rows };
    last = chats[chats.length - 1].id;
  }
}

/** What each request a teammate asked them to approve would send or change, in every workspace. */
async function blankRequests(userId: string, deadline: number): Promise<ErasurePass> {
  let rows = 0;
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    if (Date.now() >= deadline) return { done: false, rows };
    const batch: Array<{ id: string; createdAt: Date }> = await prisma.agentAction.findMany({
      where: { actingForId: userId, AND: [REQUEST_WORDS, ...after(cursor)] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ERASURE_BATCH,
      select: { id: true, createdAt: true },
    });
    if (batch.length > 0) {
      await prisma.agentAction.updateMany({
        where: { id: { in: batch.map((r) => r.id) } },
        data: { input: {}, editedInput: Prisma.DbNull, preview: {}, result: Prisma.DbNull, error: null },
      });
      rows += batch.length;
    }
    if (batch.length < ERASURE_BATCH) return { done: true, rows };
    cursor = batch[batch.length - 1];
  }
}

/** Their runs' output, Ask AI's tool runs' input and error, and the questions of those runs, in id order. */
async function blankRuns(userId: string, deadline: number): Promise<ErasurePass> {
  let rows = 0;
  let last: string | null = null;
  for (;;) {
    if (Date.now() >= deadline) return { done: false, rows };
    const batch: Array<{ id: string; actingForId: string | null; questionId: string | null }> = await prisma.agentRun.findMany({
      where: { triggeredBy: userId, ...(last ? { id: { gt: last } } : {}), ...RUN_WORDS },
      orderBy: { id: "asc" },
      take: ERASURE_BATCH,
      select: { id: true, actingForId: true, questionId: true },
    });
    const teammate = batch.filter((r) => r.actingForId !== null).map((r) => r.id);
    const askAi = batch.filter((r) => r.actingForId === null).map((r) => r.id);
    const questions = batch.map((r) => r.questionId).filter((q): q is string => typeof q === "string");
    if (teammate.length > 0) await prisma.agentRun.updateMany({ where: { id: { in: teammate } }, data: { output: Prisma.DbNull } });
    if (askAi.length > 0) await prisma.agentRun.updateMany({ where: { id: { in: askAi } }, data: { output: Prisma.DbNull, input: {}, error: null } });
    if (questions.length > 0) await prisma.aIQuery.updateMany({ where: { id: { in: questions }, ...QUESTION_WORDS }, data: { query: ERASED, response: null } });
    rows += batch.length;
    if (batch.length < ERASURE_BATCH) return { done: true, rows };
    last = batch[batch.length - 1].id;
  }
}

/**
 * The rest, each one statement (see the header): their AI questions, the
 * network details of the activity rows they authored, what teammates
 * remember about them, and their routines' words.
 */
async function blankTheRest(userId: string, deadline: number): Promise<ErasurePass> {
  let rows = 0;
  const steps = [
    () => prisma.aIQuery.updateMany({ where: { userId, ...QUESTION_WORDS }, data: { query: ERASED, response: null } }),
    () => prisma.activityLog.updateMany({ where: { actorId: userId, OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] }, data: { ipAddress: null, userAgent: null } }),
    // A teammate's shared memories (scope "agent") are the workspace's and stay.
    () => prisma.agentMemory.deleteMany({ where: { scope: "person", scopeId: userId } }),
    () =>
      prisma.agentRoutine.updateMany({
        where: { actingForId: userId, ...ROUTINE_WORDS },
        data: { name: ERASED, prompt: ERASED, status: "paused", pausedReason: "person_gone", nextRunAt: null },
      }),
  ];
  for (const step of steps) {
    if (Date.now() >= deadline) return { done: false, rows };
    rows += (await step()).count;
  }
  return { done: true, rows };
}

/**
 * Blank every one of the person's teammate and AI chat rows still holding
 * words (see the header), in batches, until it is done or `deadline` (a
 * Date.now() time) passes. Throws when a statement does; what it blanked
 * before stays blank, and the next pass goes on from there.
 */
export async function blankTeammateHistory(userId: string, deadline: number): Promise<ErasurePass> {
  let rows = 0;
  // The most sensitive first: chats and requests hold whole email bodies.
  for (const part of [blankChats, blankRequests, blankRuns, blankTheRest]) {
    const pass = await part(userId, deadline);
    rows += pass.rows;
    if (!pass.done) return { done: false, rows };
  }
  return { done: true, rows };
}

export interface ErasureSweepCounts {
  /** Erasures of the last ERASURE_SWEEP_WINDOW_MS not yet finished, read this tick. */
  found: number;
  /** Rows blanked. */
  blanked: number;
  /** Erasures recorded finished. */
  finished: number;
  /** Left for a later tick: the budget ran out, or too recent to finish (ERASURE_SETTLED_MS). */
  waiting: number;
  /** A pass that threw (logged); the next tick tries again. */
  failed: number;
}

type ErasureRow = { userId: string; createdAt: Date; policyVersion: string };

/**
 * Each tick (src/app/api/cron/run-due-agents step 5): the erasures of the
 * last ERASURE_SWEEP_WINDOW_MS not yet finished, oldest first, at most
 * `limit`, each blanked to the end within one budget for the tick (see the
 * header). One whose pass throws is counted and logged, and the people after
 * it still run; an older erasure is left alone.
 */
export async function finishErasures(now: Date, o: { limit: number; budgetMs: number }): Promise<ErasureSweepCounts> {
  const deadline = Date.now() + o.budgetMs;
  const since = new Date(now.getTime() - ERASURE_SWEEP_WINDOW_MS);
  // By the consent records' createdAt index, and each person's finished
  // record by its userId index.
  const erasures = await prisma.$queryRaw<ErasureRow[]>`
    SELECT e."userId", e."createdAt", e."policyVersion"
      FROM "ConsentRecord" e
     WHERE e."method" = ${ERASURE_METHOD}
       AND e."userId" IS NOT NULL
       AND e."createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
       AND NOT EXISTS (SELECT 1 FROM "ConsentRecord" f WHERE f."userId" = e."userId" AND f."method" = ${ERASURE_FINISHED_METHOD})
     ORDER BY e."createdAt", e."id"
     LIMIT ${o.limit}`;
  const counts: ErasureSweepCounts = { found: erasures.length, blanked: 0, finished: 0, waiting: 0, failed: 0 };
  for (const e of erasures) {
    if (Date.now() >= deadline) {
      counts.waiting += 1;
      continue;
    }
    try {
      const pass = await blankTeammateHistory(e.userId, deadline);
      counts.blanked += pass.rows;
      if (!pass.done || now.getTime() - new Date(e.createdAt).getTime() < ERASURE_SETTLED_MS) {
        counts.waiting += 1;
        continue;
      }
      await prisma.consentRecord.create({
        data: { userId: e.userId, method: ERASURE_FINISHED_METHOD, necessary: true, doNotSell: true, policyVersion: e.policyVersion, withdrawnAt: now },
      });
      counts.finished += 1;
    } catch (err) {
      counts.failed += 1;
      console.error(`[cron-failure] run-due-agents: an account erasure's words were not all blanked yet: ${err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err)}`);
    }
  }
  return counts;
}
