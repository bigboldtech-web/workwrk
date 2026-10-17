// Skills nobody can use any more, and their deletion 30 days on
// (docs/plans/ai-teammates-phase5.md Decision 14, step 3; the sweep's part
// of browser/sessions.ts sweepBrowserSessions, the cron's 10-minute tick).
//
// A SKILL IS ORPHANED when its person left the workspace or was deactivated
// (resolveActingPerson answers "gone" or "inactive" there) or its teammate
// was removed (ARCHIVED, or no longer there). The leaver hooks and the
// teammate's removal mark it at once (store.ts markSkillsOrphaned); a
// membership made, a person reactivated and a teammate restored clear it at
// once (clearSkillsOrphaned). This part catches what those missed:
//   1. a rolling check of at most CHECK_MAX skills a tick, by id from where
//      the last tick stopped (in this process; a restart starts again from
//      the first, which only re-checks), marking those whose person or
//      teammate is gone and clearing those that are back;
//   2. the delete candidates, orphaned more than 30 days, at most DELETE_MAX
//      a tick, oldest first. EACH IS CHECKED AGAIN FIRST, its person and its
//      teammate both read now (spec review 2, finding 8): one that came back
//      is cleared and kept; only the rest are deleted (their routines go with
//      them, AgentRoutine_skillId_fkey CASCADE), each by its id and its date,
//      so a clear between the check and the delete keeps it.
// Worst case of deleting by date alone: a person reactivated on day 20 by a
// path no hook covers loses every skill on day 30. With the check at delete
// time, the worst case is a skill kept a tick longer.
//
// Counts only: nothing about a skill is logged.
//
// Server-only: imports prisma.

import { resolveActingPerson } from "@/lib/agents/acting";
import { prisma } from "@/lib/prisma";
import { SKILL_LIMITS } from "./types";

/** Skills the rolling check reads a tick at most. */
export const ORPHAN_CHECK_MAX = 200;
/** Delete candidates a tick at most. */
export const ORPHAN_DELETE_MAX = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the rolling check stopped, by id (this process only). */
let rollingFrom: string | null = null;

/** For the tests: start the rolling check from the first skill again. */
export function resetOrphanCursorForTests(): void {
  rollingFrom = null;
}

export interface OrphanSweepCounts {
  marked: number;
  cleared: number;
  deleted: number;
}

type SkillKey = { organizationId: string; userId: string; agentId: string };

/**
 * Whether these skills' people and teammates are gone, each read now and
 * once a call (a person by resolveActingPerson in that workspace, a
 * teammate by its row): true, false, or null when a read failed, which
 * marks, clears and deletes nothing (never on a guess, and a clock never
 * restarted by a database hiccup).
 */
function goneReader(): (k: SkillKey) => Promise<boolean | null> {
  const people = new Map<string, Promise<boolean | null>>();
  const agents = new Map<string, Promise<boolean | null>>();
  const personGone = (org: string, user: string) => {
    const key = `${org}\u0000${user}`;
    let p = people.get(key);
    if (!p) {
      p = resolveActingPerson(org, user)
        .then((r) => !r.ok && (r.reason === "gone" || r.reason === "inactive"))
        .catch(() => null);
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
  return async (k) => {
    const [person, agent] = await Promise.all([personGone(k.organizationId, k.userId), agentGone(k.organizationId, k.agentId)]);
    if (person === true || agent === true) return true;
    return person === null || agent === null ? null : false;
  };
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
  // A short page reached the end: the next tick starts from the first again.
  rollingFrom = batch.length < checkMax ? null : (batch[batch.length - 1]?.id ?? null);
  for (const s of batch) {
    if (Date.now() >= deadline) break;
    const isGone = await gone(s);
    if (isGone === null) continue;
    if (isGone && !s.orphanedAt) {
      counts.marked += (await prisma.teammateSkill.updateMany({ where: { id: s.id, orphanedAt: null }, data: { orphanedAt: now } })).count;
    } else if (!isGone && s.orphanedAt) {
      counts.cleared += (await prisma.teammateSkill.updateMany({ where: { id: s.id, orphanedAt: { not: null } }, data: { orphanedAt: null } })).count;
    }
  }

  // 2. The delete candidates, each checked again with its people read now.
  if (Date.now() >= deadline) return counts;
  const cutoff = new Date(now.getTime() - SKILL_LIMITS.orphanDays * DAY_MS);
  const due = await prisma.teammateSkill.findMany({
    where: { orphanedAt: { lt: cutoff } },
    orderBy: { orphanedAt: "asc" },
    take: deleteMax,
    select: { id: true, organizationId: true, userId: true, agentId: true },
  });
  const fresh = goneReader();
  for (const s of due) {
    if (Date.now() >= deadline) break;
    const isGone = await fresh(s);
    if (isGone === null) continue;
    if (isGone) {
      counts.deleted += (await prisma.teammateSkill.deleteMany({ where: { id: s.id, orphanedAt: { lt: cutoff } } })).count;
    } else {
      // Back since (a path that cleared nothing): kept, and its 30 days stop.
      counts.cleared += (await prisma.teammateSkill.updateMany({ where: { id: s.id, orphanedAt: { not: null } }, data: { orphanedAt: null } })).count;
    }
  }
  return counts;
}
