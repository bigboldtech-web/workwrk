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
// THE SEAT HERE (docs/plans/workspace-status-2.md E4, E5, step 2): a
// manager's state and a line's next step are read at the seat each person
// holds here (seatsHeldFor). "Deactivated" is the seat's, so Rita, whom B
// deactivated through her membership, is refused in B as deactivated, never
// as "not in this workspace"; and the loop walk (lineAbove) climbs THIS
// workspace's lines, the account's line where someone is anchored here and
// the membership's otherwise, so B's loop check never reads A's lines.
//
// A restore or a reactivation checks the person's lines HERE (E4, step 4):
// the line their seat here holds and this workspace's dotted rows, each
// against the manager's seat here. Since E1 and E2 every line is one
// workspace's, so a line of another workspace is never read here, never
// kept for it and never cleared by it (staleLinesOf).
//
// Server-only (prisma), with no request imports.

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";
import { levelsHeldIn, personSeatIn, seatsHeldFor, type HeldSeat } from "./acting-workspace";
import { ENDED_STATUS } from "./workspace-seat";

type Db = PrismaClient | Prisma.TransactionClient;

export type ManagerCandidate = "ok" | "not_found" | "agent_cannot_manage" | "inactive";

/**
 * May `managerId` manage someone in this workspace? `db` is the caller's
 * transaction when the check must hold until its write lands (under
 * lockOrgRoles, so a role change to Agent waits for it or is seen by it).
 * `live` also refuses a deactivated person ("inactive"): someone joining or
 * coming back never lands under a manager who has left, and a deactivated
 * person holds no reports (invariant 13, pendingHandover).
 *
 * At the seat here (E4): a seat this workspace removed, or none, is
 * "not_found"; a seat it deactivated, through a membership as when anchored
 * here, or an account ended where it is anchored, is "inactive". Before, a
 * manager deactivated here through a membership read as "not in this
 * workspace", since only their account's status was read.
 */
export async function managerCandidateIn(
  organizationId: string,
  managerId: string,
  opts: { db?: Db; live?: boolean } = {},
): Promise<ManagerCandidate> {
  const db = opts.db ?? prisma;
  const m = await db.user.findFirst({ where: { id: managerId, deletedAt: null }, select: { organizationId: true, accessLevel: true, status: true, managerId: true } });
  // In this workspace at the tier held here: a manager who switched to
  // another workspace still manages their people here (batch 5).
  const seat = m ? (await seatsHeldFor(organizationId, [{ ...m, id: managerId }], db)).get(managerId) : undefined;
  if (!m || !seat) return "not_found";
  if (isAgentOf(seat.level)) return "agent_cannot_manage";
  if (opts.live && (seat.deactivated || m.status === "INACTIVE")) return "inactive";
  return "ok";
}

/**
 * The people among `ids` who hold the Agent tier in this workspace: anchored
 * here at AGENT, or working here through a membership whose role is AGENT
 * (acting-workspace.ts levelsHeldIn). Never the anchored row's level in
 * another workspace, which says nothing about this one. A deactivated seat
 * here keeps its tier (kept seats, step 1 review M2), as a deactivated
 * Agent anchored here does: an Agent manages nobody whatever their status.
 */
export async function agentIdsIn(organizationId: string, ids: readonly string[], db: Db = prisma): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const held = await levelsHeldIn(organizationId, ids, db, { keptSeats: true });
  return new Set([...held].filter(([, level]) => isAgentOf(level)).map(([id]) => id));
}

/** How many steps a walk up a line takes before it stops (reporting-lines.ts WALK_CAP). */
const LOOP_WALK_CAP = 64;

/**
 * `managerId` and everyone above them on the solid line, as the lines stand
 * in `db` now: one small read per step, inside the caller's transaction.
 * Making anyone in this set report to `managerId` would close a loop.
 *
 * THIS WORKSPACE'S LINES (E5): each step reads the line the person's seat
 * here holds (seatsHeldFor), so the locked check walks exactly the graph
 * the check before the lock walks (person-access.server.ts managerMapFor,
 * acting-workspace.ts workspacePeopleLines): the account's line for someone
 * anchored here, the membership's for anyone else. Before, it climbed the
 * account's line, which for a membership person is another workspace's: a
 * B edit was refused as a loop through Pat's A line, and a loop through her
 * B line went unseen.
 */
export async function lineAbove(organizationId: string, managerId: string, db: Db = prisma): Promise<Set<string>> {
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  while (cursor && !seen.has(cursor) && seen.size < LOOP_WALK_CAP) {
    seen.add(cursor);
    const id: string = cursor;
    const row: { managerId: string | null; organizationId: string; accessLevel: AccessLevel; status: string } | null = await db.user.findFirst({
      where: { id, deletedAt: null },
      select: { managerId: true, organizationId: true, accessLevel: true, status: true },
    });
    // The line goes on through anyone who holds a seat here (batch 5), and
    // stops where it leaves the workspace. Through someone deactivated here
    // too, by their membership as when anchored here (kept seats, step 1
    // review M2): a loop through them is still a loop.
    const seat: HeldSeat | undefined = row ? (await seatsHeldFor(organizationId, [{ ...row, id }], db)).get(id) : undefined;
    cursor = seat ? seat.managerId : null;
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
 * Why a stored reporting line here no longer holds (E4): the manager's seat
 * here was removed, they are deactivated here, they hold the Agent tier
 * here, or ("elsewhere") they hold no seat here at all.
 */
export type StaleLineReason = "agent" | "removed" | "inactive" | "elsewhere";

export interface StaleLine {
  managerId: string;
  /**
   * The manager's name, for the log; null when nothing is left to name, and
   * always null for "elsewhere": someone who holds no seat here is never
   * named here (batch 7).
   */
  name: string | null;
  why: StaleLineReason;
}

/**
 * The reporting lines a person would come back with HERE that no longer
 * hold (DELETE /api/users/[id]?restore=true, PATCH's reactivation, SCIM
 * active:true). Removal and deactivation keep a person's lines on their
 * seat, and while they were gone their manager may have moved to the Agent
 * tier (rule 6 never counted them: removed people are left out of
 * reportCountOf), been deactivated or left. So a restore asks again, in its
 * own transaction under the role lock.
 *
 * THE LINES HERE (docs/plans/workspace-status-2.md E1, E2, E4, step 4): the
 * line the person's seat here holds (personSeatIn, in any state: the
 * account's line for someone anchored here, the membership's otherwise) and
 * the dotted rows whose workspace is this one, each manager judged at the
 * seat they hold HERE. Another workspace's line of the same person is never
 * read, so it is never cleared here: before, a restore in B read the
 * account's line (A's) and every workspace's dotted rows, cleared A's line
 * and deleted A's copy of a dotted line, and never checked Pat's own B line
 * (B restored her under Rita, removed in B). A line is cleared for:
 *
 *   "removed"     the manager's seat here was removed, or their account was
 *                 (deletedAt)
 *   "inactive"    they are deactivated here, at their seat here or where
 *                 their account is anchored (their solid line only: a
 *                 deactivated person holds no reports, invariant 13; a
 *                 deactivation keeps dotted lines, so a restore does too)
 *   "agent"       they hold the Agent tier here
 *   "elsewhere"   they hold no seat here at all: cleared, and never named
 *
 * What fails is answered here; the caller clears it on the row that holds
 * the seat (seat-writes.ts writeLineHere, removeDottedHere) and logs it.
 */
export async function staleLinesOf(organizationId: string, userId: string, db: Db = prisma): Promise<{ manager: StaleLine | null; dotted: StaleLine[] }> {
  const [seat, dottedRows] = await Promise.all([
    // Any state: a restore reads a removed seat, a reactivation a deactivated one.
    personSeatIn(organizationId, userId, db),
    // This workspace's dotted lines only (E2).
    db.userDottedLine.findMany({ where: { userId, organizationId }, select: { managerId: true } }),
  ]);
  const solid = seat?.managerId ?? null;
  const ids = [...new Set([solid, ...dottedRows.map((d) => d.managerId)].filter((x): x is string => !!x))];
  const people = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, deletedAt: true, accessLevel: true, status: true, firstName: true, lastName: true } })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  // The seat each manager anchored elsewhere holds here, in any state (a
  // removed one is "removed", never "elsewhere": they were of this
  // workspace, so they may be named).
  const elsewhere = people.filter((p) => p.organizationId !== organizationId).map((p) => p.id);
  const memberships = elsewhere.length
    ? await db.organizationMembership.findMany({ where: { organizationId, userId: { in: elsewhere } }, select: { userId: true, role: true, status: true, removedAt: true } })
    : [];
  const heldThrough = new Map(memberships.map((m) => [m.userId, m]));
  const nameOf = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || null : null;
  };
  const why = (managerId: string, isSolid: boolean): StaleLineReason | null => {
    const p = byId.get(managerId);
    if (!p) return "elsewhere";
    const anchoredHere = p.organizationId === organizationId;
    const m = anchoredHere ? null : heldThrough.get(managerId);
    // No seat here at all: never named.
    if (!anchoredHere && !m) return "elsewhere";
    if (p.deletedAt || m?.removedAt) return "removed";
    const deactivated = String(p.status) === ENDED_STATUS || String(m?.status ?? "") === ENDED_STATUS;
    if (isSolid && deactivated) return "inactive";
    return isAgentOf(anchoredHere ? p.accessLevel : m!.role) ? "agent" : null;
  };
  const line = (managerId: string, w: StaleLineReason): StaleLine => ({ managerId, name: w === "elsewhere" ? null : nameOf(managerId), why: w });
  let manager: StaleLine | null = null;
  if (solid) {
    const w = why(solid, true);
    if (w) manager = line(solid, w);
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
 * "No longer in the workspace" is said only of someone whose seat here, or
 * whose account, was removed (batch 6). A manager who holds no seat here is
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
