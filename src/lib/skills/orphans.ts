// Skills nobody can use any more, and their deletion 30 days on
// (docs/plans/ai-teammates-phase5.md Decision 14, step 3; the sweep's part
// of browser/sessions.ts sweepBrowserSessions, the cron's 10-minute tick).
//
// A SKILL IS ORPHANED when its person left the workspace or was deactivated
// (resolveActingPerson would answer "gone" or "inactive" there) or its
// teammate was removed (ARCHIVED, or no longer there). The checks read only
// what that rule needs (personGoneNow, final races review, M2): the person's
// row (no row, deletedAt, INACTIVE) and whether they hold a level in that
// workspace (levelHeldIn's own rule: anchored there, or a membership there),
// never the rest of an acting person (the viewer, the AI app, the time zone),
// whose answers (a Guest, an agent account, AI off) never orphan a skill.
// The leaver hooks and the teammate's removal mark it at once
// (markSkillsOrphaned, through store.ts);
// a membership made, a person reactivated and a teammate restored clear it
// at once (clearSkillsOrphaned). orphanedAt is when the skill last became
// unusable (review of step 3), so both hooks read the cause they do not
// name, now:
//   - a mark (a person leaving, a teammate removed) sets it on the rows
//     that had none, and starts it again on a row marked before whose
//     other cause does not hold now: that skill was usable a moment ago (a
//     return by a path that cleared nothing), so its 30 days start now, never
//     from an older leave. A row whose other cause holds keeps its date:
//     unusable all along. A read that fails starts it again (kept longer,
//     never deleted early);
//   - a clear (a person back, a teammate restored) clears only the rows
//     whose other cause does not hold: a person's return leaves the skills
//     with a removed teammate marked, and a teammate's restore those of a
//     person still gone. A read that fails clears nothing (the sweep does).
// At most HOOK_CHECK_MAX rows already marked are read again by one hook;
// the sweep sees to the rest. This part catches what those missed:
//   1. a rolling check of at most CHECK_MAX skills a tick, by id from where
//      the last tick stopped (in this process; a restart starts again from
//      the first, which only re-checks), marking those whose person or
//      teammate is gone and clearing those that are back;
//   2. the delete candidates, orphaned more than 30 days, at most DELETE_MAX
//      a tick, oldest first, from where the last tick stopped (in this
//      process; a short page starts again from the oldest). EACH IS CHECKED
//      AGAIN FIRST, its person and its teammate both read now (spec review 2,
//      finding 8): one that came back is cleared and kept; only the rest are
//      deleted (their routines go with them, AgentRoutine_skillId_fkey
//      CASCADE), each by its id and its date, so a clear between the check
//      and the delete keeps it. One whose check or write fails is skipped
//      this tick, never deleted, and the tick moves on past it (final races
//      review, M2's low: one that always failed held the head of the page
//      for good).
// Worst case of deleting by date alone: a person reactivated on day 20 by a
// path no hook covers loses every skill on day 30. With the check at delete
// time, the worst case is a skill kept a tick longer.
//
// Counts only: nothing about a skill is logged.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { SKILL_LIMITS } from "./types";

/** Skills the rolling check reads a tick at most. */
export const ORPHAN_CHECK_MAX = 200;
/** Delete candidates a tick at most. */
export const ORPHAN_DELETE_MAX = 500;
/** Rows already marked one mark or clear reads again at most (the sweep's own page). */
export const HOOK_CHECK_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the rolling check stopped, by id (this process only). */
let rollingFrom: string | null = null;
/** Where the delete candidates stopped, by their date and id (this process only). */
let deleteFrom: { at: Date; id: string } | null = null;

/** For the tests: start the rolling check and the delete candidates from the first again. */
export function resetOrphanCursorForTests(): void {
  rollingFrom = null;
  deleteFrom = null;
}

/**
 * Whether a skill's person is gone from a workspace now, by the orphan rule
 * (see the header): exactly when resolveActingPerson answers "gone" or
 * "inactive" there. No row, or a deleted one, is gone; INACTIVE is gone; a
 * person holding no level in that workspace (levelHeldIn: anchored there,
 * else a membership there) is gone. Every other answer resolveActingPerson
 * can give (a Guest, an agent account, AI off) is not. One or two reads by
 * key, where resolveActingPerson makes about ten. Throws when a read fails;
 * the callers read that as "not known". orphans-gone.test.ts holds it to
 * resolveActingPerson's own answers.
 */
export async function personGoneNow(organizationId: string, userId: string): Promise<boolean> {
  const row = await prisma.user.findFirst({ where: { id: userId }, select: { organizationId: true, status: true, deletedAt: true } });
  if (!row || row.deletedAt) return true;
  if (row.status === "INACTIVE") return true;
  // levelHeldIn's own rule, read for whether there is a level, never which:
  // anchored here, the row's own (never null, a column with a default);
  // anchored elsewhere, a membership here (its role never null either).
  if (row.organizationId === organizationId) return false;
  const held = await prisma.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { userId: true } });
  return !held;
}

export interface OrphanSweepCounts {
  marked: number;
  cleared: number;
  deleted: number;
}

type SkillKey = { organizationId: string; userId: string; agentId: string };

/**
 * Whether these skills' people and teammates are gone, each read now and
 * once a call (a person by personGoneNow in that workspace, a teammate by
 * its row): true, false, or null when a read failed, which marks, clears
 * and deletes nothing (never on a guess, and a clock never restarted by a
 * database hiccup).
 */
function goneReaders(): { personGone: (org: string, user: string) => Promise<boolean | null>; agentGone: (org: string, agentId: string) => Promise<boolean | null> } {
  const people = new Map<string, Promise<boolean | null>>();
  const agents = new Map<string, Promise<boolean | null>>();
  const personGone = (org: string, user: string) => {
    const key = `${org}\u0000${user}`;
    let p = people.get(key);
    if (!p) {
      p = personGoneNow(org, user).catch(() => null);
      people.set(key, p);
    }
    return p;
  };
  const agentGone = (org: string, agentId: string) => {
    const key = `${org}\u0000${agentId}`;
    let p = agents.get(key);
    if (!p) {
      p = prisma.agent
        .findFirst({ where: { id: agentId, organizationId: org }, select: { status: true } })
        .then((a) => !a || String(a.status) === "ARCHIVED")
        .catch(() => null);
      agents.set(key, p);
    }
    return p;
  };
  return { personGone, agentGone };
}

function goneReader(): (k: SkillKey) => Promise<boolean | null> {
  const { personGone, agentGone } = goneReaders();
  return async (k) => {
    const [person, agent] = await Promise.all([personGone(k.organizationId, k.userId), agentGone(k.organizationId, k.agentId)]);
    if (person === true || agent === true) return true;
    return person === null || agent === null ? null : false;
  };
}

// ── The hooks' mark and clear (Decision 14, review of step 3) ─────────

export type OrphanWhere = { organizationId: string; userIds?: readonly string[]; agentId?: string };

/** The rows a mark or a clear is about: a person's (or people's) or a teammate's, never a whole workspace by accident. */
function orphanFilter(w: OrphanWhere): Prisma.TeammateSkillWhereInput | null {
  const users = (w.userIds ?? []).filter((u) => typeof u === "string" && u.length > 0);
  if (users.length === 0 && !w.agentId) return null;
  return { organizationId: w.organizationId, ...(users.length > 0 ? { userId: { in: users } } : {}), ...(w.agentId ? { agentId: w.agentId } : {}) };
}

/**
 * The cause a hook does not name, read now for one skill: by person, its
 * teammate gone; by teammate, its person gone; naming both, none (false).
 * True, false, or null when a read failed.
 */
function otherCause(w: OrphanWhere): (s: { userId: string; agentId: string }) => Promise<boolean | null> {
  const { personGone, agentGone } = goneReaders();
  const byPerson = (w.userIds ?? []).some((u) => typeof u === "string" && u.length > 0);
  if (byPerson && !w.agentId) return (s) => agentGone(w.organizationId, s.agentId);
  if (!byPerson && w.agentId) return (s) => personGone(w.organizationId, s.userId);
  return async () => false;
}

/** The rows of a hook already marked, at most HOOK_CHECK_MAX, by id. */
function markedRows(f: Prisma.TeammateSkillWhereInput): Promise<Array<{ id: string; userId: string; agentId: string }>> {
  return prisma.teammateSkill.findMany({ where: { ...f, orphanedAt: { not: null } }, orderBy: { id: "asc" }, take: HOOK_CHECK_MAX, select: { id: true, userId: true, agentId: true } });
}

/**
 * Its person left or was deactivated, or its teammate was removed: the 30
 * days begin now (Decision 14; see the header for a row marked before). The
 * leaver hooks and the teammate removal route call it (step 3). Answers how
 * many rows it marked or started again.
 */
export async function markSkillsOrphaned(where: OrphanWhere, now: Date): Promise<number> {
  const f = orphanFilter(where);
  if (!f) return 0;
  // Read before this mark writes, so only rows marked by an earlier event are read again.
  const before = await markedRows(f);
  let n = (await prisma.teammateSkill.updateMany({ where: { ...f, orphanedAt: null }, data: { orphanedAt: now } })).count;
  const other = otherCause(where);
  const again: string[] = [];
  for (const s of before) if ((await other(s)) !== true) again.push(s.id);
  if (again.length > 0) n += (await prisma.teammateSkill.updateMany({ where: { id: { in: again }, orphanedAt: { not: null } }, data: { orphanedAt: now } })).count;
  return n;
}

/**
 * Its person or teammate came back: the 30 days stop (Decision 14), only
 * for the rows whose other cause does not hold now (see the header). The
 * teammate restore route and store.ts skillsBackFor call it. Answers how
 * many it cleared.
 */
export async function clearSkillsOrphaned(where: OrphanWhere): Promise<number> {
  const f = orphanFilter(where);
  if (!f) return 0;
  const marked = await markedRows(f);
  if (marked.length === 0) return 0;
  const other = otherCause(where);
  const back: string[] = [];
  for (const s of marked) if ((await other(s)) === false) back.push(s.id);
  if (back.length === 0) return 0;
  return (await prisma.teammateSkill.updateMany({ where: { id: { in: back }, orphanedAt: { not: null } }, data: { orphanedAt: null } })).count;
}

/** The sweep's part (see the header), until `deadline` (a Date.now() time). Counts only. */
export async function sweepOrphanSkills(now: Date, o: { deadline?: number; checkMax?: number; deleteMax?: number } = {}): Promise<OrphanSweepCounts> {
  const counts: OrphanSweepCounts = { marked: 0, cleared: 0, deleted: 0 };
  const deadline = o.deadline ?? Number.POSITIVE_INFINITY;
  const checkMax = Math.max(0, o.checkMax ?? ORPHAN_CHECK_MAX);
  const deleteMax = Math.max(0, o.deleteMax ?? ORPHAN_DELETE_MAX);

  // 1. The rolling check, by id from where the last tick stopped.
  const gone = goneReader();
  const batch = await prisma.teammateSkill.findMany({
    where: rollingFrom ? { id: { gt: rollingFrom } } : {},
    orderBy: { id: "asc" },
    take: checkMax,
    select: { id: true, organizationId: true, userId: true, agentId: true, orphanedAt: true },
  });
  let checked = 0;
  for (const s of batch) {
    if (Date.now() >= deadline) break;
    checked += 1;
    try {
      const isGone = await gone(s);
      if (isGone === null) continue;
      if (isGone && !s.orphanedAt) {
        counts.marked += (await prisma.teammateSkill.updateMany({ where: { id: s.id, orphanedAt: null }, data: { orphanedAt: now } })).count;
      } else if (!isGone && s.orphanedAt) {
        counts.cleared += (await prisma.teammateSkill.updateMany({ where: { id: s.id, orphanedAt: { not: null } }, data: { orphanedAt: null } })).count;
      }
    } catch {
      // A write that failed: this one waits for the next pass, and the rest go on.
    }
  }
  // From the last one read; a short page read whole reached the end, so the next tick starts from the first again.
  if (checked === batch.length && batch.length < checkMax) rollingFrom = null;
  else if (checked > 0) rollingFrom = batch[checked - 1].id;

  // 2. The delete candidates, each checked again with its people read now,
  // from where the last tick stopped, so one that always fails never holds
  // the head of the page.
  if (Date.now() >= deadline) return counts;
  const cutoff = new Date(now.getTime() - SKILL_LIMITS.orphanDays * DAY_MS);
  const from = deleteFrom;
  const due = await prisma.teammateSkill.findMany({
    where: { orphanedAt: { lt: cutoff }, ...(from ? { OR: [{ orphanedAt: { gt: from.at } }, { orphanedAt: from.at, id: { gt: from.id } }] } : {}) },
    orderBy: [{ orphanedAt: "asc" }, { id: "asc" }],
    take: deleteMax,
    select: { id: true, organizationId: true, userId: true, agentId: true, orphanedAt: true },
  });
  const fresh = goneReader();
  let read = 0;
  for (const s of due) {
    if (Date.now() >= deadline) break;
    read += 1;
    if (s.orphanedAt) deleteFrom = { at: s.orphanedAt, id: s.id };
    try {
      const isGone = await fresh(s);
      // Not known (a read failed): skipped this tick, never deleted on a guess.
      if (isGone === null) continue;
      if (isGone) {
        counts.deleted += (await prisma.teammateSkill.deleteMany({ where: { id: s.id, orphanedAt: { lt: cutoff } } })).count;
      } else {
        // Back since (a path that cleared nothing): kept, and its 30 days stop.
        counts.cleared += (await prisma.teammateSkill.updateMany({ where: { id: s.id, orphanedAt: { not: null } }, data: { orphanedAt: null } })).count;
      }
    } catch {
      // A write that failed: skipped this tick, never deleted, and the rest go on.
    }
  }
  // A short page read whole reached the newest: the next tick starts from the oldest again.
  if (read === due.length && due.length < deleteMax) deleteFrom = null;
  return counts;
}
