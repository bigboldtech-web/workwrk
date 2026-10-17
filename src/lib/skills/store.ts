// A person's skills in the database (docs/plans/ai-teammates-phase5.md
// Decisions 3, 10 and 14, step 2): a recording's row, its steps as the
// recorder gives them, its end, and the viewer's own reads.
//
// ONE PERSON'S SKILLS UNDER ONE LOCK (73_040, the spec's conventions): every
// skill insert, the caps and the one recording are counted under
// pg_advisory_xact_lock(73040, hashtext(userId)), taken before any count, so
// two starts at once never pass a cap or make two recordings.
//
// THE STEPS ARE WRITTEN WHOLE, by the one process that holds the browser
// (Phase 4 Decision 7), and only while the row is still recording: nothing
// typed or chosen is in them (src/lib/skills/steps.ts), and a write never
// lands on a draft the person is reviewing.
//
// EVERY READ IS THE VIEWER'S OWN (Decision 25): by their id in their
// workspace; anyone else's, an Owner's included, is not there.
//
// Server logs carry codes only (`[skills] <op> <code>`): never a name, a step
// or a value, and never a database error's detail, which can hold the row.
//
// Server-only: imports prisma.

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { skillSites, storedSteps } from "./steps";
import { SKILL_LIMITS, type RecordingEnd, type SkillStep } from "./types";

/** One person's skills (the spec's lock class 73_040). */
export const SKILL_LOCK_CLASS = 73_040;

export type SkillCapRefusal = "too_many_for_teammate" | "too_many" | "recordings_today" | "already_recording" | "name_taken";

/** A database error's code only (see the header). */
function codeOf(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  return err instanceof Error ? err.name : "error";
}

/**
 * A recording's row, under the person's lock (see the header): the counts
 * first, in one statement (this person's skills with this teammate and in the
 * workspace, any recording of theirs, and a skill of that name with this
 * teammate, case aside), then the recordings they started since the UTC day
 * began, counted by their sessions' take_over steps with code "recording"
 * (so a discarded recording, whose row is gone, still counts), then the
 * insert. Each refusal its own reason. `tx` is the caller's transaction (the
 * record route swaps the card and the session in it too).
 */
export async function createRecording(
  tx: Prisma.TransactionClient,
  a: { organizationId: string; userId: string; agentId: string; name: string; sessionId: string; startUrl: string },
): Promise<{ ok: true; skillId: string } | { ok: false; reason: SkillCapRefusal }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SKILL_LOCK_CLASS}::int, hashtext(${a.userId}))`;
  const [c] = await tx.$queryRaw<Array<{ withTeammate: number; inWorkspace: number; recording: number; sameName: number }>>`
    SELECT count(*) FILTER (WHERE "agentId" = ${a.agentId})::int AS "withTeammate",
           count(*)::int AS "inWorkspace",
           count(*) FILTER (WHERE "status" = 'recording')::int AS "recording",
           count(*) FILTER (WHERE "agentId" = ${a.agentId} AND lower("name") = lower(${a.name}))::int AS "sameName"
      FROM "TeammateSkill"
     WHERE "organizationId" = ${a.organizationId} AND "userId" = ${a.userId}`;
  if (Number(c?.recording ?? 0) > 0) return { ok: false, reason: "already_recording" };
  if (Number(c?.withTeammate ?? 0) >= SKILL_LIMITS.perTeammate) return { ok: false, reason: "too_many_for_teammate" };
  if (Number(c?.inWorkspace ?? 0) >= SKILL_LIMITS.perPerson) return { ok: false, reason: "too_many" };
  // Their sessions that can hold a step of today: started since an hour
  // before the UTC day began (a session lasts at most 30 minutes), on
  // ("userId", "startedAt").
  const [d] = await tx.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS "n"
      FROM "TeammateBrowserStep" st
      JOIN "TeammateBrowserSession" s ON s."id" = st."browserSessionId"
     WHERE s."userId" = ${a.userId}
       AND s."startedAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 hour'
       AND st."kind" = 'take_over' AND st."code" = 'recording'
       AND st."at" >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
  if (Number(d?.n ?? 0) >= SKILL_LIMITS.recordingsPerDay) return { ok: false, reason: "recordings_today" };
  if (Number(c?.sameName ?? 0) > 0) return { ok: false, reason: "name_taken" };
  const row = await tx.teammateSkill.create({
    data: { organizationId: a.organizationId, userId: a.userId, agentId: a.agentId, name: a.name, status: "recording", recordingSessionId: a.sessionId, startUrl: a.startUrl || null },
    select: { id: true },
  });
  return { ok: true, skillId: row.id };
}

/**
 * A recording's steps so far, written whole (see the header), only while it
 * is still recording; false when it is not (finished, discarded, deleted).
 */
export async function writeRecordedSteps(skillId: string, steps: SkillStep[], full: boolean): Promise<boolean> {
  const list = steps.slice(0, SKILL_LIMITS.recordedStepsMax);
  try {
    const out = await prisma.teammateSkill.updateMany({
      where: { id: skillId, status: "recording" },
      data: { steps: list as unknown as Prisma.InputJsonValue, stepCount: list.length, sites: skillSites(list), recordingFull: full, updatedAt: new Date() },
    });
    return out.count === 1;
  } catch (err) {
    console.error(`[skills] steps not written ${codeOf(err)}`);
    // Not known to be gone: the poll tries again at its next tick.
    return true;
  }
}

/**
 * A recording's end: kept, with a step the person did (any step but the
 * start), from "recording" to "draft" with when and why, by a swap on its
 * status; otherwise deleted. `finished` says this call did it, so only one
 * end is audited and told.
 */
export async function finishRecordingRow(skillId: string, keep: boolean, reason: RecordingEnd): Promise<{ kept: boolean; steps: number; sites: string[]; finished: boolean }> {
  const row = await prisma.teammateSkill.findFirst({ where: { id: skillId, status: "recording" }, select: { steps: true, stepCount: true, sites: true } });
  if (!row) return { kept: false, steps: 0, sites: [], finished: false };
  const steps = storedSteps(row.steps);
  const sites = Array.isArray(row.sites) ? row.sites.filter((s): s is string => typeof s === "string") : [];
  const now = new Date();
  if (keep && steps.some((s) => s.kind !== "start")) {
    const swap = await prisma.teammateSkill.updateMany({
      where: { id: skillId, status: "recording" },
      data: { status: "draft", recordingEndedAt: now, recordingEndReason: reason, updatedAt: now },
    });
    return swap.count === 1 ? { kept: true, steps: row.stepCount, sites, finished: true } : { kept: false, steps: 0, sites: [], finished: false };
  }
  const gone = await prisma.teammateSkill.deleteMany({ where: { id: skillId, status: "recording" } });
  return { kept: false, steps: 0, sites, finished: gone.count === 1 };
}

export const SKILL_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  agentId: true,
  name: true,
  description: true,
  status: true,
  version: true,
  steps: true,
  stepCount: true,
  sites: true,
  startUrl: true,
  recordingSessionId: true,
  recordingFull: true,
  recordingEndedAt: true,
  recordingEndReason: true,
  orphanedAt: true,
  lastRunAt: true,
  runCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type SkillRow = Prisma.TeammateSkillGetPayload<{ select: typeof SKILL_SELECT }>;

/** The viewer's own skills with one teammate, newest first (Decision 25). */
export async function skillsOfViewer(viewer: { userId: string; organizationId: string }, agentId: string): Promise<SkillRow[]> {
  if (typeof agentId !== "string" || !agentId || agentId.length > 64) return [];
  return prisma.teammateSkill.findMany({
    where: { userId: viewer.userId, organizationId: viewer.organizationId, agentId },
    orderBy: { createdAt: "desc" },
    take: SKILL_LIMITS.perTeammate * 2,
    select: SKILL_SELECT,
  });
}

/** One skill, only the viewer's own in their workspace; null for anyone else's, an Owner's included (Decision 25). */
export async function ownSkill(viewer: { userId: string; organizationId: string }, id: string): Promise<SkillRow | null> {
  if (typeof id !== "string" || !id || id.length > 64) return null;
  return prisma.teammateSkill.findFirst({ where: { id, userId: viewer.userId, organizationId: viewer.organizationId }, select: SKILL_SELECT });
}

type OrphanWhere = { organizationId: string; userIds?: readonly string[]; agentId?: string };

/** The rows a mark or a clear is about: a person's (or people's) or a teammate's, never a whole workspace by accident. */
function orphanFilter(w: OrphanWhere): Prisma.TeammateSkillWhereInput | null {
  const users = (w.userIds ?? []).filter((u) => typeof u === "string" && u.length > 0);
  if (users.length === 0 && !w.agentId) return null;
  return { organizationId: w.organizationId, ...(users.length > 0 ? { userId: { in: users } } : {}), ...(w.agentId ? { agentId: w.agentId } : {}) };
}

/** Its person left or was deactivated, or its teammate was removed: the 30 days begin (Decision 14). Only where they had not. Step 3 calls it. */
export async function markSkillsOrphaned(where: OrphanWhere, now: Date): Promise<number> {
  const f = orphanFilter(where);
  if (!f) return 0;
  return (await prisma.teammateSkill.updateMany({ where: { ...f, orphanedAt: null }, data: { orphanedAt: now } })).count;
}

/** Its person or teammate came back: the 30 days stop (Decision 14). Step 3 calls it. */
export async function clearSkillsOrphaned(where: OrphanWhere): Promise<number> {
  const f = orphanFilter(where);
  if (!f) return 0;
  return (await prisma.teammateSkill.updateMany({ where: { ...f, orphanedAt: { not: null } }, data: { orphanedAt: null } })).count;
}
