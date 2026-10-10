// The words of a person's AI teammates and AI chats, blanked after their
// account erasure (POST /api/me/delete; review rounds 5 and 6 of Phase 3).
//
// TWO PARTS. The erasure's own transaction is short: the workspace locks, the
// last-admin re-check, the person's open runs and running requests failed,
// their User row anonymised, a few small deletes, the consent record and the
// person's "AccountErasure" row (recordErasure). Before, it also blanked their
// whole teammate history in that one 20 second transaction, so a person with
// 30 hourly routines (about 260,000 runs and report rows a year) timed it out
// every time and could never erase their account, and their teammates'
// answers in flight were lost while it held their runs. Now, after it
// commits, continueErasure blanks what is left in batches of ERASURE_BATCH
// rows, each its own short statement, within a budget; finishErasures, a step
// of the teammates cron, goes on with every erasure not finished.
//
// PROGRESS (review round 6 of Phase 3). Round 5's sweep started every erasure
// again from its first row on every tick, gave the oldest unfinished one the
// whole budget, and gave up on any older than 30 days, so one history of
// about a million rows could never finish, held up every erasure after it
// with no alert, and their words stayed for good. Now each erasure's row
// keeps where its pass stopped (the part, ERASURE_PARTS, and a cursor in it),
// saved after every slice of work, so a pass goes on where the last slice
// stopped and a pass over a million rows ends in a bounded number of ticks.
// Each tick gives every erasure it reads a fair slice of what is left of its
// budget, least recently tried first, round after round, so one heavy history
// never holds up the rest. Nothing is dropped for its age: an erasure not
// finished ERASURE_OVERDUE_MS after it was asked fails the tick, so ops is
// told, and is still swept.
//
// WHY AFTER THE COMMIT IS SAFE, AND WHEN IT IS FINISHED. From the erasure's
// commit on, budget.ts runState reads every run of theirs as closed or
// person_gone, so no teammate turn of theirs writes again; a turn that saved
// before the commit has its rows blanked here. Their sessions ended with the
// commit too (tokenVersion). What can still land is a request already in
// flight at that moment, within minutes: an Ask AI answer still streaming, a
// decided line in a chat, a memory or a routine a tool saved just before the
// commit. So an erasure is finished only by a whole pass that STARTED at
// least ERASURE_SETTLED_MS after it (passStartedAt). A pass that reaches the
// end before then goes back to the first part, and one more whole pass runs
// once that time has passed; only when a pass that started after it reaches
// the end is finishedAt set, and the sweep reads that person no more.
//
// ONLY A REAL ERASURE (review round 6 of Phase 3). Round 5's sweep picked
// people by their consent record (method "erasure") alone, and POST
// /api/consent stored whatever method a request named, so a living account's
// words could be blanked. Now the erasure's own pass and the sweep act only on
// a person whose User row is deleted and who has an AccountErasure row, which
// only the erasure's own transaction writes (and the bridge below, for the
// erasures made before round 6, each by its provenance record).
//
// AN ERASED ACCOUNT STAYS ERASED (review round 8 of Phase 3). The bridge
// recognised an erasure by the anonymised address and deletedAt, so an
// account an identity provider renamed (SCIM wrote the real address back) or
// an Admin restored never got its row, and its words stayed for good. Now the
// bridge goes by the erasure's provenance record alone (src/lib/compliance/
// erased-account.ts), and every path that could rename or restore an erased
// account refuses. Each slice first puts the anonymisation back on a deleted
// account that lost it (reanonymise), which mends the rows rewritten before.
// An erased account restored before this (deletedAt null) is never blanked:
// what was written after the restore is not the erased person's to lose. It
// is counted `restored`, apart from `overdue`, and never fails the tick.
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
// Each batch reads the next ERASURE_BATCH rows in its index's order from
// where the last stopped, whether or not they still hold words, and writes
// only those that do (review round 6 of Phase 3: a read for rows holding
// words walked every blank row before the next one, so a pass over a long
// history already blanked was one unbounded statement). Every part is the
// same update the erasure made before, split; no row is deleted but the
// memories, as before.
//
// Server-only: imports prisma.

import { Prisma } from "@/generated/prisma";
import { ERASURE_METHOD } from "@/lib/compliance/erased-account";
import { prisma } from "@/lib/prisma";
import { RUN_STALE_MS } from "./budget";

export { ERASURE_METHOD };

/** Rows one statement blanks at most. */
export const ERASURE_BATCH = 500;

/** How long the erasure's own request spends blanking after its commit; the sweep finishes the rest. */
export const ERASURE_INLINE_BUDGET_MS = 20_000;

/**
 * How long after an erasure a request already in flight at its commit could
 * still write: as long as budget.ts gives a live turn. Only a pass that
 * started after this finishes the erasure.
 */
export const ERASURE_SETTLED_MS = RUN_STALE_MS;

/**
 * An erasure still not finished this long after it was asked fails the
 * tick, so ops is told; it keeps being swept (review round 6 of Phase 3).
 * Counted from the later of erasedAt and the row's createdAt (review round 8
 * of Phase 3): a bridged erasure from months ago was overdue the moment it
 * was bridged, so a backlog failed every tick and the six hour alert
 * de-duplication (src/lib/cron-result.ts) hid the real failures.
 */
export const ERASURE_OVERDUE_MS = 3 * 24 * 60 * 60 * 1000;

/** The longest one erasure's slice of a tick runs before its progress is saved and the next one's turn comes. */
export const ERASURE_SLICE_MAX_MS = 5_000;

/**
 * Pages of `limit` unfinished erasures one tick reads at most, the next one
 * read only while the budget lasts (review round 8 of Phase 3: one page a
 * tick drained a backlog of light erasures far slower than the budget could).
 */
export const ERASURE_PAGES_PER_TICK = 4;

/**
 * Round 5's record of a finished erasure. No longer written: AccountErasure's
 * finishedAt replaces it (review round 6 of Phase 3). Only the bridge reads it.
 */
export const ERASURE_FINISHED_METHOD = "erasure_finished";

/**
 * Erasures the bridge gives a row each tick at most. It reads every erasure
 * consent record with no date bound (review round 7 of Phase 3), through the
 * partial index of prisma/sql/2026-10-11-ai-teammates-phase3-round7.sql.
 * Review round 8 of Phase 3: 200 a tick, never tried, sorted ahead of the
 * sweep's 50 a tick, so during a backlog no current erasure was read for
 * hours; now 25, each marked tried at its bridging, so rows already waiting
 * go first.
 */
export const ERASURE_BRIDGE_PER_TICK = 25;

/** The parts of one pass, in order (the CHECK on "AccountErasure"."part"). The most sensitive first: chats and requests hold whole email bodies. */
export const ERASURE_PARTS = ["chats", "requests", "runs", "questions", "activity", "memories", "routines"] as const;
export type ErasurePart = (typeof ERASURE_PARTS)[number];

/**
 * Where a part stopped, null at its first row:
 *   chats: { after } every chat of theirs up to that id is done, or
 *          { chat, at?, id? } that chat is under way, its messages done
 *          through (at, id);
 *   requests: { at, id }; runs: { id }; the rest are one statement each.
 */
export type ErasureCursor = Record<string, string> | null;

export interface ErasurePosition {
  part: ErasurePart;
  cursor: ErasureCursor;
}

export const ERASURE_START: ErasurePosition = { part: ERASURE_PARTS[0], cursor: null };

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
const ASK_AI_RUN_WORDS: Prisma.AgentRunWhereInput = {
  OR: [{ output: { not: Prisma.DbNull } }, { input: { not: {} } }, { error: { not: null } }],
};
const QUESTION_WORDS: Prisma.AIQueryWhereInput = { OR: [{ query: { not: ERASED } }, { response: { not: null } }] };
const ROUTINE_WORDS: Prisma.AgentRoutineWhereInput = {
  OR: [{ name: { not: ERASED } }, { prompt: { not: ERASED } }, { status: { not: "paused" } }, { nextRunAt: { not: null } }],
};

/** A pass under way: its place, moved on after every batch, and the rows it blanked. */
interface Progress extends ErasurePosition {
  rows: number;
}

/** Rows after this one in (createdAt, id) order, for an index on createdAt. */
function after(c: { createdAt: Date; id: string }) {
  return { createdAt: { gte: c.createdAt }, OR: [{ createdAt: { gt: c.createdAt } }, { id: { gt: c.id } }] };
}

/** A (createdAt, id) place kept in a cursor, or null. */
function keyOf(c: ErasureCursor): { createdAt: Date; id: string } | null {
  if (!c || typeof c.at !== "string" || typeof c.id !== "string") return null;
  const createdAt = new Date(c.at);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id: c.id };
}

/** One chat's messages from `from` on, in (createdAt, id) order. Whether it reached the chat's end. */
async function blankMessagesOf(sessionId: string, from: { createdAt: Date; id: string } | null, p: Progress, deadline: number): Promise<boolean> {
  let place = from;
  for (;;) {
    if (Date.now() >= deadline) return false;
    const batch: Array<{ id: string; createdAt: Date }> = await prisma.chatMessage.findMany({
      where: { sessionId, ...(place ? { AND: [after(place)] } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ERASURE_BATCH,
      select: { id: true, createdAt: true },
    });
    if (batch.length > 0) {
      const w = await prisma.chatMessage.updateMany({
        where: { id: { in: batch.map((m) => m.id) }, ...MESSAGE_WORDS },
        data: { content: ERASED, toolCalls: Prisma.DbNull, meta: Prisma.DbNull },
      });
      p.rows += w.count;
      place = batch[batch.length - 1];
      p.cursor = { chat: sessionId, at: place.createdAt.toISOString(), id: place.id };
    }
    if (batch.length < ERASURE_BATCH) return true;
  }
}

/** Every chat they own, with Ask AI or a teammate, in every workspace, in id order: its title, then its messages. */
async function blankChats(userId: string, p: Progress, deadline: number): Promise<boolean> {
  for (;;) {
    if (Date.now() >= deadline) return false;
    // From the chat under way (it is read again), or after the last one done.
    const under = typeof p.cursor?.chat === "string" ? p.cursor.chat : null;
    const done = typeof p.cursor?.after === "string" ? p.cursor.after : null;
    const chats: Array<{ id: string }> = await prisma.chatSession.findMany({
      where: { userId, ...(under ? { id: { gte: under } } : done ? { id: { gt: done } } : {}) },
      orderBy: { id: "asc" },
      take: ERASURE_BATCH,
      select: { id: true },
    });
    if (chats.length > 0) {
      const titled = await prisma.chatSession.updateMany({ where: { id: { in: chats.map((c) => c.id) }, title: { not: null } }, data: { title: null } });
      p.rows += titled.count;
    }
    for (const c of chats) {
      const from = p.cursor?.chat === c.id ? keyOf(p.cursor) : null;
      if (!(await blankMessagesOf(c.id, from, p, deadline))) return false;
      p.cursor = { after: c.id };
    }
    if (chats.length < ERASURE_BATCH) return true;
  }
}

/** What each request a teammate asked them to approve would send or change, in every workspace. */
async function blankRequests(userId: string, p: Progress, deadline: number): Promise<boolean> {
  for (;;) {
    if (Date.now() >= deadline) return false;
    const place = keyOf(p.cursor);
    const batch: Array<{ id: string; createdAt: Date }> = await prisma.agentAction.findMany({
      where: { actingForId: userId, ...(place ? { AND: [after(place)] } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ERASURE_BATCH,
      select: { id: true, createdAt: true },
    });
    if (batch.length > 0) {
      const w = await prisma.agentAction.updateMany({
        where: { id: { in: batch.map((r) => r.id) }, ...REQUEST_WORDS },
        data: { input: {}, editedInput: Prisma.DbNull, preview: {}, result: Prisma.DbNull, error: null },
      });
      p.rows += w.count;
      const last = batch[batch.length - 1];
      p.cursor = { at: last.createdAt.toISOString(), id: last.id };
    }
    if (batch.length < ERASURE_BATCH) return true;
  }
}

/** Their runs' output, Ask AI's tool runs' input and error, and the questions of those runs, in id order. */
async function blankRuns(userId: string, p: Progress, deadline: number): Promise<boolean> {
  for (;;) {
    if (Date.now() >= deadline) return false;
    const last = typeof p.cursor?.id === "string" ? p.cursor.id : null;
    const batch: Array<{ id: string; actingForId: string | null; questionId: string | null }> = await prisma.agentRun.findMany({
      where: { triggeredBy: userId, ...(last ? { id: { gt: last } } : {}) },
      orderBy: { id: "asc" },
      take: ERASURE_BATCH,
      select: { id: true, actingForId: true, questionId: true },
    });
    const teammate = batch.filter((r) => r.actingForId !== null).map((r) => r.id);
    const askAi = batch.filter((r) => r.actingForId === null).map((r) => r.id);
    const questions = batch.map((r) => r.questionId).filter((q): q is string => typeof q === "string");
    if (teammate.length > 0) {
      p.rows += (await prisma.agentRun.updateMany({ where: { id: { in: teammate }, output: { not: Prisma.DbNull } }, data: { output: Prisma.DbNull } })).count;
    }
    if (askAi.length > 0) {
      p.rows += (await prisma.agentRun.updateMany({ where: { id: { in: askAi }, ...ASK_AI_RUN_WORDS }, data: { output: Prisma.DbNull, input: {}, error: null } })).count;
    }
    if (questions.length > 0) {
      p.rows += (await prisma.aIQuery.updateMany({ where: { id: { in: questions }, ...QUESTION_WORDS }, data: { query: ERASED, response: null } })).count;
    }
    if (batch.length > 0) p.cursor = { id: batch[batch.length - 1].id };
    if (batch.length < ERASURE_BATCH) return true;
  }
}

/** A part that is one statement (see the header). */
function once(step: (userId: string) => Promise<{ count: number }>) {
  return async (userId: string, p: Progress, deadline: number): Promise<boolean> => {
    if (Date.now() >= deadline) return false;
    p.rows += (await step(userId)).count;
    return true;
  };
}

const PART_RUNNERS: Record<ErasurePart, (userId: string, p: Progress, deadline: number) => Promise<boolean>> = {
  chats: blankChats,
  requests: blankRequests,
  runs: blankRuns,
  questions: once((userId) => prisma.aIQuery.updateMany({ where: { userId, ...QUESTION_WORDS }, data: { query: ERASED, response: null } })),
  activity: once((userId) =>
    prisma.activityLog.updateMany({ where: { actorId: userId, OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] }, data: { ipAddress: null, userAgent: null } }),
  ),
  // A teammate's shared memories (scope "agent") are the workspace's and stay.
  memories: once((userId) => prisma.agentMemory.deleteMany({ where: { scope: "person", scopeId: userId } })),
  routines: once((userId) =>
    prisma.agentRoutine.updateMany({
      where: { actingForId: userId, ...ROUTINE_WORDS },
      data: { name: ERASED, prompt: ERASED, status: "paused", pausedReason: "person_gone", nextRunAt: null },
    }),
  ),
};

/** The pass from p's place to its end, or until `deadline`. Whether it reached the end; p holds where it stopped. */
async function runPass(userId: string, p: Progress, deadline: number): Promise<boolean> {
  for (let i = ERASURE_PARTS.indexOf(p.part); i < ERASURE_PARTS.length; i += 1) {
    if (ERASURE_PARTS[i] !== p.part) {
      p.part = ERASURE_PARTS[i];
      p.cursor = null;
    }
    if (!(await PART_RUNNERS[p.part](userId, p, deadline))) return false;
  }
  return true;
}

/** One stretch of a pass: whether it reached the end, the rows it blanked, and where it stopped. */
export interface ErasurePass extends ErasurePosition {
  done: boolean;
  rows: number;
}

/**
 * Blank the person's teammate and AI chat rows still holding words (see the
 * header), in batches, from `from` (the first row of the first part when
 * left out) until the pass ends or `deadline` (a Date.now() time) passes.
 * Throws when a statement does; what it blanked before stays blank.
 */
export async function blankTeammateHistory(userId: string, deadline: number, from: ErasurePosition = ERASURE_START): Promise<ErasurePass> {
  const p: Progress = { part: from.part, cursor: from.cursor, rows: 0 };
  const done = await runPass(userId, p, deadline);
  return { done, rows: p.rows, part: p.part, cursor: p.cursor };
}

/** An "AccountErasure" row as the sweep reads it. */
interface ErasureRow {
  userId: string;
  erasedAt: Date;
  part: string;
  cursor: unknown;
  passStartedAt: Date | null;
  tries: number;
}

/**
 * How one slice ended: "finished"; "settling", a pass reached the end before
 * the settle time and the last pass waits for it; "more", the slice's time
 * ran out with its place saved; "taken", another pass moved the row first.
 */
type SliceEnd = "finished" | "settling" | "more" | "taken";

interface Slice {
  end: SliceEnd;
  rows: number;
  /** The row as this slice left it, for the next round of the tick. */
  row: ErasureRow;
  /** 1 when this slice put the account's anonymisation back (reanonymise). */
  mended?: number;
}

/** A saved place the code can use, else the first row of the first part. */
function positionOf(e: ErasureRow): ErasurePosition {
  const part = (ERASURE_PARTS as readonly string[]).includes(e.part) ? (e.part as ErasurePart) : null;
  if (!part) return ERASURE_START;
  const c = e.cursor;
  const cursor = c && typeof c === "object" && !Array.isArray(c) && Object.values(c).every((v) => typeof v === "string") ? (c as Record<string, string>) : null;
  return { part, cursor };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Save where a slice left the row, and that it was tried, only while the row
 * is as this slice read it (its tries, which every save and every restart
 * moves on), so two passes at once, or a pass and a restart, never write
 * over each other's place.
 */
async function save(
  e: ErasureRow,
  s: ErasurePosition & { passStartedAt: Date | null; finishedAt: Date | null },
  end: SliceEnd,
  rows: number,
): Promise<Slice> {
  const n = await prisma.$executeRaw`
    UPDATE "AccountErasure"
       SET "part" = ${s.part}::text,
           "cursor" = ${s.cursor === null ? null : JSON.stringify(s.cursor)}::jsonb,
           "passStartedAt" = (${iso(s.passStartedAt)}::timestamptz AT TIME ZONE 'UTC'),
           "finishedAt" = (${iso(s.finishedAt)}::timestamptz AT TIME ZONE 'UTC'),
           "lastTriedAt" = (now() AT TIME ZONE 'UTC'),
           "tries" = "tries" + 1
     WHERE "userId" = ${e.userId} AND "tries" = ${e.tries}::int AND "finishedAt" IS NULL`;
  const row: ErasureRow = { ...e, part: s.part, cursor: s.cursor, passStartedAt: s.passStartedAt, tries: e.tries + 1 };
  return { end: n === 1 ? end : "taken", rows, row };
}

/**
 * Put the anonymisation back on an erased account that lost it (review round
 * 8 of Phase 3): an identity provider's SCIM push wrote the person's real
 * address and names back onto the row before SCIM refused erased accounts.
 * The same values POST /api/me/delete writes, only while the account is
 * deleted (an account restored before round 8 keeps what it holds), and only
 * when one of them differs, so it writes nothing on almost every call.
 *
 * Why it cannot deadlock: it is one statement by primary key, outside any
 * transaction, that locks at most this one User row and holds no other lock
 * while it waits for it. budget.ts runState takes a run row FOR UPDATE and
 * then this User row FOR SHARE; this statement may wait for runState's
 * transaction to commit, but that transaction never waits on anything this
 * statement holds, so no cycle can pass through it. It changes no key column,
 * so no foreign key check locks another row.
 */
async function reanonymise(userId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "User"
       SET "email" = ('deleted-' || "id" || '@workwrk.anon'),
           "firstName" = 'Deleted',
           "lastName" = 'User',
           "avatar" = NULL,
           "phone" = NULL,
           "dateOfBirth" = NULL,
           "status" = 'INACTIVE',
           "updatedAt" = (now() AT TIME ZONE 'UTC')
     WHERE "id" = ${userId}
       AND "deletedAt" IS NOT NULL
       AND ("email" <> ('deleted-' || "id" || '@workwrk.anon')
            OR "firstName" <> 'Deleted'
            OR "lastName" <> 'User'
            OR "avatar" IS NOT NULL
            OR "phone" IS NOT NULL
            OR "dateOfBirth" IS NOT NULL
            OR "status" <> 'INACTIVE')`;
}

/**
 * One slice of one erasure, from its saved place until the pass ends or
 * `deadline` passes (see the header): a pass that started at least
 * ERASURE_SETTLED_MS after the erasure finishes it at its end; one that
 * started before goes back to the first part, and when the settle time has
 * already passed the last pass starts at once, in this slice. Every slice
 * first puts the account's anonymisation back if it was lost (reanonymise).
 * Throws when a statement does, after saving the place it reached.
 */
async function runSlice(e: ErasureRow, now: Date, deadline: number): Promise<Slice> {
  const settledAt = new Date(e.erasedAt).getTime() + ERASURE_SETTLED_MS;
  const p: Progress = { ...positionOf(e), rows: 0 };
  let passStartedAt = e.passStartedAt ? new Date(e.passStartedAt) : null;
  if (passStartedAt === null) {
    // Waiting for its last pass, which never starts before the settle time.
    if (now.getTime() < settledAt) return { end: "settling", rows: 0, row: e };
    passStartedAt = now;
    p.part = ERASURE_START.part;
    p.cursor = null;
  }
  try {
    const mended = await reanonymise(e.userId);
    const saved = async (s: ErasurePosition & { passStartedAt: Date | null; finishedAt: Date | null }, end: SliceEnd): Promise<Slice> => {
      const out = await save(e, s, end, p.rows);
      return { ...out, mended };
    };
    for (;;) {
      if (!(await runPass(e.userId, p, deadline))) return await saved({ part: p.part, cursor: p.cursor, passStartedAt, finishedAt: null }, "more");
      if (passStartedAt.getTime() >= settledAt) return await saved({ part: p.part, cursor: null, passStartedAt, finishedAt: now }, "finished");
      if (now.getTime() < settledAt) return await saved({ ...ERASURE_START, passStartedAt: null, finishedAt: null }, "settling");
      // The settle time passed while this pass ran: the last one starts now.
      passStartedAt = now;
      p.part = ERASURE_START.part;
      p.cursor = null;
    }
  } catch (err) {
    // What was blanked stays blank; keep the place too, so the next try goes on from it.
    await save(e, { part: p.part, cursor: p.cursor, passStartedAt, finishedAt: null }, "more", p.rows).catch(() => undefined);
    throw err;
  }
}

/**
 * The person's AccountErasure row, written in the erasure's own transaction
 * (POST /api/me/delete), beside its consent record: a pass starts at the
 * erasure's moment, from the first row of the first part. An erasure asked
 * again starts over: the first part, no cursor, not finished, its moment the
 * new one, and its tries moved on so a slice still running from before can
 * never save over it.
 */
export async function recordErasure(db: Pick<Prisma.TransactionClient, "$executeRaw">, userId: string, at: Date): Promise<void> {
  const when = at.toISOString();
  await db.$executeRaw`
    INSERT INTO "AccountErasure" ("userId", "erasedAt", "part", "cursor", "passStartedAt", "lastTriedAt", "tries", "finishedAt", "createdAt")
    VALUES (${userId}, (${when}::timestamptz AT TIME ZONE 'UTC'), ${ERASURE_START.part}::text, NULL::jsonb,
            (${when}::timestamptz AT TIME ZONE 'UTC'), NULL::timestamp(3), 0, NULL::timestamp(3), (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("userId") DO UPDATE
       SET "erasedAt" = EXCLUDED."erasedAt",
           "part" = EXCLUDED."part",
           "cursor" = NULL,
           "passStartedAt" = EXCLUDED."passStartedAt",
           "lastTriedAt" = NULL,
           "finishedAt" = NULL,
           "tries" = "AccountErasure"."tries" + 1`;
}

/**
 * The erasure's own pass, after its transaction commits (POST
 * /api/me/delete): one slice of the person's erasure, from the place its row
 * holds (the start, as that transaction left it), until `deadline`, its
 * place saved. Acts only on a deleted account with an unfinished erasure row
 * (`found` false otherwise, nothing read). Throws when a statement does.
 */
export async function continueErasure(userId: string, deadline: number, now: Date = new Date()): Promise<{ found: boolean; end: SliceEnd | null; rows: number }> {
  const [row] = await prisma.$queryRaw<ErasureRow[]>`
    SELECT e."userId", e."erasedAt", e."part", e."cursor", e."passStartedAt", e."tries"
      FROM "AccountErasure" e
      JOIN "User" u ON u."id" = e."userId"
     WHERE e."userId" = ${userId}
       AND e."finishedAt" IS NULL
       AND u."deletedAt" IS NOT NULL`;
  if (!row) return { found: false, end: null, rows: 0 };
  const s = await runSlice(row, now, deadline);
  return { found: true, end: s.end, rows: s.rows };
}

/**
 * Erasures that have a consent record and no AccountErasure row get one, its
 * moment the consent record's, a pass starting now. Those are every erasure
 * made before round 6 of Phase 3 (review round 7): before round 3, the
 * erasure blanked an Ask AI question's text but kept the person's chats, the
 * requests they approved, their runs' output, their memories and their
 * routines' words; round 5's pass may have left some. Before, only erasures
 * from 2026-10-10 on were bridged, so the older ones kept those words for
 * good. Only for an erasure's provenance record (method "erasure", withdrawnAt
 * and userId set, which only POST /api/me/delete has ever written; see
 * src/lib/compliance/erased-account.ts), with no row yet and no round 5
 * "finished" record. Review round 8 of Phase 3: it also asked for the
 * anonymised address and deletedAt, so an account an identity provider
 * renamed, or an Admin restored, was never bridged and kept its words for
 * good. A restored account is given its row too, and the sweep leaves it
 * alone while it lives (it is counted `restored`). One statement, at most
 * ERASURE_BRIDGE_PER_TICK a tick, over the erasure records' own index; each
 * row marked tried now, so the rows already waiting are read before it; once
 * every erasure has a row it reads that short list and writes nothing.
 * Answers how many rows it wrote.
 */
async function bridgeUnsweptErasures(now: Date): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "AccountErasure" ("userId", "erasedAt", "part", "cursor", "passStartedAt", "lastTriedAt", "tries", "finishedAt", "createdAt")
    SELECT DISTINCT ON (c."userId") c."userId", c."createdAt", ${ERASURE_START.part}::text, NULL::jsonb,
           (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), 0, NULL::timestamp(3), (now() AT TIME ZONE 'UTC')
      FROM "ConsentRecord" c
      JOIN "User" u ON u."id" = c."userId"
     WHERE c."method" = ${ERASURE_METHOD}
       AND c."withdrawnAt" IS NOT NULL
       AND c."userId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "AccountErasure" a WHERE a."userId" = c."userId")
       AND NOT EXISTS (SELECT 1 FROM "ConsentRecord" f WHERE f."userId" = c."userId" AND f."method" = ${ERASURE_FINISHED_METHOD})
     ORDER BY c."userId", c."createdAt" DESC
     LIMIT ${ERASURE_BRIDGE_PER_TICK}
    ON CONFLICT ("userId") DO NOTHING`;
}

export interface ErasureSweepCounts {
  /** Unfinished erasures read this tick, on every page: those with a pass under way, and those whose last pass may start. */
  found: number;
  /** Rows blanked. */
  blanked: number;
  /** Erasures finished. */
  finished: number;
  /** Read and left for a later tick: the budget ran out, or the last pass waits for the settle time. */
  waiting: number;
  /** A slice that threw, or the bridge, a later page's read or the overdue count (logged); the next tick tries again. */
  failed: number;
  /** Erasures of deleted accounts not finished ERASURE_OVERDUE_MS after they were asked or bridged (logged); they fail the tick. */
  overdue: number;
  /**
   * Unfinished erasures whose account an Admin restored before review round
   * 8 of Phase 3 (deletedAt null): never blanked while it lives, and not a
   * failure, since nothing here can finish it (the founder lists them).
   */
  restored: number;
  /** Erased accounts whose anonymisation a slice put back (reanonymise). */
  reanonymised: number;
  /** AccountErasure rows written for erasures made before round 6 of Phase 3. */
  bridged: number;
}

function errorLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n").pop() ?? err.message) : String(err);
}

/**
 * Each tick (src/app/api/cron/run-due-agents step 5, see the header): the
 * bridge for the erasures made before round 6; then pages of at most
 * `limit` unfinished erasures of deleted accounts, least recently tried
 * first, each given in turn a fair slice of what is left of the budget (what
 * is left over the erasures still to go this round, at most
 * ERASURE_SLICE_MAX_MS), round after round until the budget is spent or none
 * has work left this tick. Review round 8 of Phase 3: after each round, while
 * the budget lasts and the last page was full, the next page is read (at most
 * ERASURE_PAGES_PER_TICK, none read twice in a tick) and joins the rounds, so
 * a backlog of light erasures drains at the speed of the budget, not 50 a
 * tick. One whose slice throws is counted and logged, and the others still
 * run. Last, the erasures overdue, and those restored, are counted.
 */
export async function finishErasures(now: Date, o: { limit: number; budgetMs: number }): Promise<ErasureSweepCounts> {
  const deadline = Date.now() + o.budgetMs;
  const counts: ErasureSweepCounts = { found: 0, blanked: 0, finished: 0, waiting: 0, failed: 0, overdue: 0, restored: 0, reanonymised: 0, bridged: 0 };
  try {
    counts.bridged = await bridgeUnsweptErasures(now);
  } catch (err) {
    counts.failed += 1;
    console.error(`[cron-failure] run-due-agents: earlier account erasures were not given their rows: ${errorLine(err)}`);
  }

  // By the partial index over the unfinished rows, in its order. A row
  // waiting for its last pass is read once that pass may start. A row read
  // on an earlier page of this tick is never read again in it.
  const settledBefore = new Date(now.getTime() - ERASURE_SETTLED_MS).toISOString();
  const seen: string[] = [];
  let pages = 0;
  let lastPageFull = false;
  const readPage = async (): Promise<ErasureRow[]> => {
    const rows = await prisma.$queryRaw<ErasureRow[]>`
      SELECT e."userId", e."erasedAt", e."part", e."cursor", e."passStartedAt", e."tries"
        FROM "AccountErasure" e
        JOIN "User" u ON u."id" = e."userId"
       WHERE e."finishedAt" IS NULL
         AND u."deletedAt" IS NOT NULL
         AND (e."passStartedAt" IS NOT NULL OR e."erasedAt" <= (${settledBefore}::timestamptz AT TIME ZONE 'UTC'))
         AND NOT (e."userId" = ANY(${[...seen]}::text[]))
       ORDER BY e."lastTriedAt" ASC NULLS FIRST, e."erasedAt", e."userId"
       LIMIT ${o.limit}`;
    pages += 1;
    lastPageFull = o.limit > 0 && rows.length >= o.limit;
    for (const r of rows) seen.push(r.userId);
    counts.found += rows.length;
    return rows;
  };

  let slicesFailed = 0;
  let active = await readPage();
  while (Date.now() < deadline) {
    const more: ErasureRow[] = [];
    for (let i = 0; i < active.length; i += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        more.push(...active.slice(i));
        break;
      }
      const slice = Math.min(remaining / (active.length - i), ERASURE_SLICE_MAX_MS);
      try {
        const s = await runSlice(active[i], now, Date.now() + slice);
        counts.blanked += s.rows;
        counts.reanonymised += s.mended ?? 0;
        if (s.end === "finished") counts.finished += 1;
        else if (s.end === "more") more.push(s.row);
      } catch (err) {
        slicesFailed += 1;
        console.error(`[cron-failure] run-due-agents: an account erasure's words were not all blanked yet: ${errorLine(err)}`);
      }
    }
    active = more;
    if (Date.now() >= deadline) break;
    if (lastPageFull && pages < ERASURE_PAGES_PER_TICK) {
      try {
        active.push(...(await readPage()));
      } catch (err) {
        lastPageFull = false;
        counts.failed += 1;
        console.error(`[cron-failure] run-due-agents: the next page of account erasures was not read: ${errorLine(err)}`);
      }
    }
    if (active.length === 0) break;
  }
  counts.failed += slicesFailed;
  counts.waiting = counts.found - counts.finished - slicesFailed;

  // Overdue from the later of the erasure's moment and its row's (a bridged
  // row's createdAt is its bridging); an account restored while unfinished
  // is counted apart and fails nothing (review round 8 of Phase 3).
  try {
    const overdueBefore = new Date(now.getTime() - ERASURE_OVERDUE_MS).toISOString();
    const [late] = await prisma.$queryRaw<Array<{ overdue: number; restored: number }>>`
      SELECT count(*) FILTER (WHERE u."deletedAt" IS NOT NULL
                                AND GREATEST(e."erasedAt", e."createdAt") < (${overdueBefore}::timestamptz AT TIME ZONE 'UTC'))::int AS "overdue",
             count(*) FILTER (WHERE u."deletedAt" IS NULL)::int AS "restored"
        FROM "AccountErasure" e
        JOIN "User" u ON u."id" = e."userId"
       WHERE e."finishedAt" IS NULL`;
    counts.overdue = Number(late?.overdue ?? 0);
    counts.restored = Number(late?.restored ?? 0);
    if (counts.overdue > 0) {
      console.error(`[cron-failure] run-due-agents: ${counts.overdue} account erasure(s) not finished ${ERASURE_OVERDUE_MS / 86_400_000} days after they were asked`);
    }
  } catch (err) {
    counts.failed += 1;
    console.error(`[cron-failure] run-due-agents: the overdue account erasures were not counted: ${errorLine(err)}`);
  }
  return counts;
}
