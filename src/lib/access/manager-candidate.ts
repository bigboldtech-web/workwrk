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
// Server-only (prisma), with no request imports.

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";

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
  const m = await db.user.findFirst({ where: { id: managerId, organizationId, deletedAt: null }, select: { accessLevel: true, status: true } });
  if (!m) return "not_found";
  if (isAgentOf(m.accessLevel)) return "agent_cannot_manage";
  if (opts.live && m.status === "INACTIVE") return "inactive";
  return "ok";
}

/** The people among `ids` in this workspace who hold the Agent tier. */
export async function agentIdsIn(organizationId: string, ids: readonly string[], db: Db = prisma): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.user.findMany({ where: { id: { in: [...ids] }, organizationId }, select: { id: true, accessLevel: true } });
  return new Set(rows.filter((r) => isAgentOf(r.accessLevel)).map((r) => r.id));
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
 *                      (managerCandidateIn with `live`: same workspace, not
 *                      removed, no Agent, not deactivated, since a
 *                      deactivated person holds no reports, invariant 13)
 *   each dotted line   must not be to an Agent or a removed person (a
 *                      deactivated dotted-line manager is kept, as a
 *                      deactivation keeps dotted lines)
 *
 * What fails is answered here; the caller clears it and logs it.
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
    const why: StaleLineReason | null = !p || p.organizationId !== organizationId || p.deletedAt ? "removed" : isAgentOf(p.accessLevel) ? "agent" : null;
    if (why) dotted.push({ managerId: d, name: nameOf(d), why });
  }
  return { manager, dotted };
}

/** The log's words for why a line was cleared ("Dana Ray is on the Agent tier, and an Agent can't be anyone's manager"). */
export function staleLineWords(line: StaleLine): string {
  const who = line.name ?? "Their manager";
  if (line.why === "agent") return `${who} is on the Agent tier, and an Agent can't be anyone's manager`;
  if (line.why === "inactive") return `${who} is deactivated`;
  return `${who} is no longer in the workspace`;
}
