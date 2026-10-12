// "An Agent is never anyone's manager" (access 2.4, AGENT_TIER_BLURB), for
// the server paths outside a request's people context: an invitation's
// Reports to (sendInvitation, and managerOnAccept when it is accepted), the
// handover's report plan, a restore and every write of a reporting line under
// the role lock (rule 6's race, docs-found fixes batch 3). The same rule as
// person-access.server.ts checkManagerCandidate and agentIdsAmong (same
// workspace, not removed, never the Agent tier), kept here because the tier
// is the engine's to read (the G7 lint rule) and these modules must stay
// importable outside a request.
//
// "In this workspace" is the level a person holds here (acting-workspace.ts
// levelHeldIn: anchored here, or a membership here), never User.organizationId
// alone, which is only the workspace they last switched to on any device
// (docs-found fixes batch 5). "Removed" is a removed account (deletedAt) or
// someone who holds no level here.
//
// Server-only (prisma), with no request imports.

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";
import { levelHeldIn, levelsHeldFor, levelsHeldIn } from "./acting-workspace";

type Db = PrismaClient | Prisma.TransactionClient;

export type ManagerCandidate = "ok" | "not_found" | "agent_cannot_manage" | "inactive";

/**
 * May `managerId` manage someone in this workspace? `db` is the caller's
 * transaction when the check must hold until its write lands (under
 * lockOrgRoles, so a role change to Agent waits for it or is seen by it).
 * `live` also refuses a deactivated person ("inactive"): someone joining or
 * coming back never lands under a manager who has left, and a deactivated
 * person holds no reports (invariant 13, pendingHandover).
 */
export async function managerCandidateIn(
  organizationId: string,
  managerId: string,
  opts: { db?: Db; live?: boolean } = {},
): Promise<ManagerCandidate> {
  const db = opts.db ?? prisma;
  const m = await db.user.findFirst({ where: { id: managerId, deletedAt: null }, select: { organizationId: true, accessLevel: true, status: true } });
  // In this workspace at the tier held here: a manager who switched to
  // another workspace still manages their people here (batch 5).
  const level = m ? await levelHeldIn(managerId, organizationId, m, db) : null;
  if (!m || level === null) return "not_found";
  if (isAgentOf(level)) return "agent_cannot_manage";
  if (opts.live && m.status === "INACTIVE") return "inactive";
  return "ok";
}

/**
 * The people among `ids` who hold the Agent tier in this workspace: anchored
 * here at AGENT, or working here through a membership whose role is AGENT
 * (acting-workspace.ts levelsHeldIn). Never the anchored row's level in
 * another workspace, which says nothing about this one.
 */
export async function agentIdsIn(organizationId: string, ids: readonly string[], db: Db = prisma): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const held = await levelsHeldIn(organizationId, ids, db);
  return new Set([...held].filter(([, level]) => isAgentOf(level)).map(([id]) => id));
}

/** How many steps a walk up a line takes before it stops (reporting-lines.ts WALK_CAP). */
const LOOP_WALK_CAP = 64;

/**
 * `managerId` and everyone above them on the solid line, as the lines stand
 * in `db` now: one small read per step, inside the caller's transaction.
 * Making anyone in this set report to `managerId` would close a loop.
 */
export async function lineAbove(organizationId: string, managerId: string, db: Db = prisma): Promise<Set<string>> {
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  while (cursor && !seen.has(cursor) && seen.size < LOOP_WALK_CAP) {
    seen.add(cursor);
    const row: { managerId: string | null; organizationId: string; accessLevel: AccessLevel } | null = await db.user.findFirst({
      where: { id: cursor, deletedAt: null },
      select: { managerId: true, organizationId: true, accessLevel: true },
    });
    // The line goes on through anyone who holds a level here (batch 5), and
    // stops where it leaves the workspace.
    cursor = row && (await levelHeldIn(cursor, organizationId, row, db)) !== null ? row.managerId : null;
  }
  return seen;
}

/**
 * Would making `managerId` the manager of `subjectId` close a loop, as the
 * lines stand in `db` now (lineAbove)? Run under lockOrgRoles, two crossing
 * edits (A to report to B while B is set to report to A) go one after the
 * other, so the second sees the first and is refused (docs-found fixes
 * batch 4). A pre-existing loop elsewhere never blocks an unrelated write.
 */
export async function wouldLoopIn(organizationId: string, subjectId: string, managerId: string | null, db: Db = prisma): Promise<boolean> {
  if (!managerId) return false;
  return (await lineAbove(organizationId, managerId, db)).has(subjectId);
}

/** Why a stored reporting line no longer holds. */
export type StaleLineReason = "agent" | "removed" | "inactive";

export interface StaleLine {
  managerId: string;
  /** The manager's name, for the log; null when nothing is left to name. */
  name: string | null;
  why: StaleLineReason;
}

/**
 * The reporting lines a person would come back with that no longer hold
 * (DELETE /api/users/[id]?restore=true). Removal keeps a person's lines, and
 * while they were gone their manager may have moved to the Agent tier, been
 * deactivated or left: rule 6 never counted them, because removed people
 * are left out of reportCountOf. So a restore asks again, in its own
 * transaction under the role lock:
 *
 *   their manager      must still be someone who may manage them now
 *                      (managerCandidateIn with `live`: holds a level in this
 *                      workspace, not removed, no Agent, not deactivated,
 *                      since a deactivated person holds no reports,
 *                      invariant 13)
 *   each dotted line   must not be to an Agent here or a removed person (a
 *                      deactivated dotted-line manager is kept, as a
 *                      deactivation keeps dotted lines)
 *
 * A manager who works here through a membership, anchored in another
 * workspace since they last switched, is still in this workspace: their
 * lines are kept (batch 5; before, they were cleared and logged as "no
 * longer in the workspace").
 *
 * What fails is answered here; the caller clears it and logs it. A
 * reactivation asks the same (PATCH /api/users/[id], SCIM active:true).
 */
export async function staleLinesOf(organizationId: string, userId: string, db: Db = prisma): Promise<{ manager: StaleLine | null; dotted: StaleLine[] }> {
  const [row, dottedRows] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { managerId: true } }),
    db.userDottedLine.findMany({ where: { userId }, select: { managerId: true } }),
  ]);
  const ids = [...new Set([row?.managerId ?? null, ...dottedRows.map((d) => d.managerId)].filter((x): x is string => !!x))];
  const people = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, deletedAt: true, accessLevel: true, firstName: true, lastName: true } })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  // The level each holds HERE: anchored here, or through a membership here.
  const heldHere = await levelsHeldFor(organizationId, people, db);
  const nameOf = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null : null;
  };
  let manager: StaleLine | null = null;
  if (row?.managerId) {
    const c = await managerCandidateIn(organizationId, row.managerId, { db, live: true });
    if (c !== "ok") manager = { managerId: row.managerId, name: nameOf(row.managerId), why: c === "agent_cannot_manage" ? "agent" : c === "inactive" ? "inactive" : "removed" };
  }
  const dotted: StaleLine[] = [];
  for (const d of [...new Set(dottedRows.map((x) => x.managerId))]) {
    const p = byId.get(d);
    const held = heldHere.get(d);
    const why: StaleLineReason | null = !p || p.deletedAt || held === undefined ? "removed" : isAgentOf(held) ? "agent" : null;
    if (why) dotted.push({ managerId: d, name: nameOf(d), why });
  }
  return { manager, dotted };
}

/**
 * The log's words for why a line was cleared ("Dana Ray is on the Agent tier,
 * and an Agent can't be anyone's manager"). "No longer in the workspace" is
 * said only of a removed account or someone who holds no level here, never
 * of someone who works here through a membership (batch 5).
 */
export function staleLineWords(line: StaleLine): string {
  const who = line.name ?? "Their manager";
  if (line.why === "agent") return `${who} is on the Agent tier, and an Agent can't be anyone's manager`;
  if (line.why === "inactive") return `${who} is deactivated`;
  return `${who} is no longer in the workspace`;
}

/**
 * The audit sentence for one line a restore or a reactivation cleared:
 * "Reactivated Max Chen with no manager: Dana Ray is deactivated".
 */
export function clearedLineSentence(verb: "Restored" | "Reactivated", name: string, line: StaleLine, solid: boolean): string {
  return solid
    ? `${verb} ${name} with no manager: ${staleLineWords(line)}`
    : `${verb} ${name} without their dotted line to ${line.name ?? "a former manager"}: ${staleLineWords(line)}`;
}
