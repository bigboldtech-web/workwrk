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
// A restore or a reactivation clears only lines this workspace owns
// (batch 6): User.managerId and UserDottedLine are one row each, read by
// every workspace the person belongs to, so a line to someone who holds no
// level here but works with the person in another workspace is that
// workspace's, and is kept (staleLinesOf).
//
// Server-only (prisma), with no request imports.

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";
import { levelHeldIn, levelsHeldFor, levelsHeldIn, lineKey, lineStandingsElsewhere } from "./acting-workspace";

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

/**
 * Why a stored reporting line no longer holds: the manager's account was
 * removed, they are deactivated, they hold the Agent tier here, or
 * ("elsewhere", batch 6) they hold no level here nor in any other workspace
 * the person works in, so no workspace reads the line.
 */
export type StaleLineReason = "agent" | "removed" | "inactive" | "elsewhere";

export interface StaleLine {
  managerId: string;
  /**
   * The manager's name, for the log; null when nothing is left to name, and
   * always null for "elsewhere": someone who holds no level here is never
   * named here (batch 7).
   */
  name: string | null;
  why: StaleLineReason;
}

/**
 * The reporting lines a person would come back with that no longer hold
 * (DELETE /api/users/[id]?restore=true). Removal keeps a person's lines, and
 * while they were gone their manager may have moved to the Agent tier, been
 * deactivated or left: rule 6 never counted them, because removed people
 * are left out of reportCountOf. So a restore asks again, in its own
 * transaction under the role lock.
 *
 * WHOSE LINE IT IS COMES FIRST (batch 7). A manager who holds no level here
 * is never asked about here: whether their account was removed or
 * deactivated is another workspace's business, and saying so would tell this
 * one who they are. Before, a removed or deactivated manager was answered
 * first, so a line the person's other workspace had was cleared with "Dana
 * Ray is no longer in the workspace", untrue (she was never here) and naming
 * her. Now, for such a manager:
 *
 *   kept          another workspace the person works in reads the line
 *                 (acting-workspace.ts lineStandingsElsewhere: "relied" or
 *                 "shared"), a deactivated manager there included (batch 8):
 *                 there the line waits for that workspace's own handover (an
 *                 Owner the identity provider deactivated keeps their reports
 *                 on purpose until someone hands them over), so a restore or
 *                 a reactivation here never clears it
 *   "elsewhere"   no workspace reads it (no answer for a removed or Guest
 *                 manager, or one who works in none of the person's
 *                 workspaces): cleared, and never named
 *
 * For a manager who holds a level here (anchored here, or a membership here,
 * batch 5), a line is cleared only for:
 *
 *   "removed"     their account was removed (deletedAt)
 *   "inactive"    they are deactivated (their solid line only: a deactivated
 *                 person holds no reports, invariant 13; a deactivation keeps
 *                 dotted lines, so a restore does too)
 *   "agent"       they hold the Agent tier here, unless another workspace
 *                 the person works in relies on the line (the manager holds
 *                 a level there that is no Agent)
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
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, deletedAt: true, accessLevel: true, status: true, firstName: true, lastName: true } })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  // The level each holds HERE: anchored here, or through a membership here.
  const heldHere = await levelsHeldFor(organizationId, people, db);
  // How each line stands in the other workspaces the person works in, a
  // deactivated or removed manager included (`leaving`): a removed one is
  // left out below, from their row (batch 8).
  const there = await lineStandingsElsewhere(organizationId, ids.map((managerId) => ({ personId: userId, managerId })), db, { leaving: true });
  const nameOf = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null : null;
  };
  const why = (managerId: string, solid: boolean): StaleLineReason | null => {
    const p = byId.get(managerId);
    const held = heldHere.get(managerId);
    const standing = p && !p.deletedAt ? there.get(lineKey({ personId: userId, managerId }))?.standing : undefined;
    // No level here: whose line it is decides, before anything about them.
    // A deactivated manager there still holds it there (batch 8).
    if (!p || held === undefined) return standing ? null : "elsewhere";
    // As linesElsewhere answers it for someone who holds a level here: a
    // deactivated manager is relied on nowhere, so the solid line is cleared
    // ("inactive") and an Agent's dotted line is the Agent's to clear.
    const elsewhere = p.status === "INACTIVE" ? undefined : standing;
    if (p.deletedAt) return "removed";
    if (solid && p.status === "INACTIVE") return "inactive";
    return isAgentOf(held) && elsewhere !== "relied" ? "agent" : null;
  };
  const line = (managerId: string, w: StaleLineReason): StaleLine => ({ managerId, name: w === "elsewhere" ? null : nameOf(managerId), why: w });
  let manager: StaleLine | null = null;
  if (row?.managerId) {
    const w = why(row.managerId, true);
    if (w) manager = line(row.managerId, w);
  }
  const dotted: StaleLine[] = [];
  for (const d of [...new Set(dottedRows.map((x) => x.managerId))]) {
    const w = why(d, false);
    if (w) dotted.push(line(d, w));
  }
  return { manager, dotted };
}

/**
 * The words for why a line was cleared, to follow "because" or a colon
 * ("Dana Ray is on the Agent tier, and an Agent can't be anyone's manager").
 * "No longer in the workspace" is said only of a removed account of someone
 * who held a level here (batch 6). A manager who holds no level here is
 * never named (batch 7): "the manager on their record doesn't work in this
 * workspace", which is true whether or not they ever did.
 */
export function staleLineWords(line: StaleLine): string {
  if (line.why === "elsewhere") return "the manager on their record doesn't work in this workspace";
  const who = line.name ?? "their manager";
  if (line.why === "agent") return `${who} is on the Agent tier, and an Agent can't be anyone's manager`;
  if (line.why === "inactive") return `${who} is deactivated`;
  return `${who} is no longer in the workspace`;
}

/**
 * The audit sentence for one line a restore or a reactivation cleared:
 * "Reactivated Max Chen with no manager: Dana Ray is deactivated".
 */
export function clearedLineSentence(verb: "Restored" | "Reactivated", name: string, line: StaleLine, solid: boolean): string {
  if (solid) return `${verb} ${name} with no manager: ${staleLineWords(line)}`;
  // Never named (batch 7): someone who holds no level here.
  if (line.why === "elsewhere") return `${verb} ${name} without a dotted line to someone who doesn't work in this workspace`;
  return `${verb} ${name} without their dotted line to ${line.name ?? "a former manager"}: ${staleLineWords(line)}`;
}
