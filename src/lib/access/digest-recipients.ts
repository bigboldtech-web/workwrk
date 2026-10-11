// Who a manager digest of /api/email/send-reminders goes to, and which tasks
// it may name to them, as the engine reads both. Docs-found fixes batch 4.
//
// THE MANAGER. A line about a person goes to the manager they report to for
// every read that grants reach (manager-lines.ts effectiveManagersOf): their
// stored manager, or past an Agent the next person up who is none. The
// digests read the stored line as it stands, so an Agent who kept reports
// from before rule 6 got their people's overdue work by email every Monday,
// though an Agent is no one's manager. A manager who is removed, deactivated,
// holds no level in this workspace or holds the Agent tier here gets none,
// and nobody is their own manager. Only people anchored in this workspace
// have a manager here (effectiveManagersOf), as on the team pages: someone
// who works here through a membership reports to a manager in their own
// workspace.
//
// WHAT THEY MAY READ. A task's title reaches a manager only when they can
// open it in the app: Can view or more on its List (the node resolver), or
// they are one of its assignees. The team pages hold the same rule (a title
// on a List the viewer cannot open never leaks: team/members-work and
// team/person-work read only readableBoardsFor). listsEachCanRead answers
// for every manager and List of a page over ONE world and one read of
// everyone's rows on it, never a resolver call per task or per manager.
//
// Server-only (prisma). Kept in src/lib/access: the tier and the member
// tables are the engine's to read (the G7 lint rule).

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { effectiveManagersOf } from "./manager-lines";
import { isAgentOf } from "./org-role";
import { NodeEvaluator, nodeCtxFromLevel, roleAtLeast, type NodeViewer } from "./node-rules";
import { grantsWithViewer, loadAllGrants, loadRows } from "./node-world";
import { RULE_1_DENIED_STATUSES } from "./resolve";

type Db = PrismaClient | Prisma.TransactionClient;

export interface DigestManager {
  id: string;
  email: string;
  firstName: string;
  /** How the engine reads them in this workspace, for listsEachCanRead. */
  viewer: NodeViewer;
}

/**
 * The digest manager of each of these people (THE MANAGER, above). People
 * with none are absent from the answer.
 */
export async function digestManagersOf(organizationId: string, personIds: readonly string[], db: Db = prisma): Promise<Map<string, DigestManager>> {
  const out = new Map<string, DigestManager>();
  const effective = await effectiveManagersOf(organizationId, personIds, db);
  const ids = [...new Set([...effective.values()].filter((m): m is string => !!m))];
  if (ids.length === 0) return out;
  const rows = await db.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, email: true, firstName: true, status: true, organizationId: true, accessLevel: true },
  });
  // The level each holds HERE: their own where they are anchored here, the
  // membership's role where they work here from another workspace.
  const elsewhere = rows.filter((r) => r.organizationId !== organizationId).map((r) => r.id);
  const held = elsewhere.length
    ? new Map((await db.organizationMembership.findMany({ where: { organizationId, userId: { in: elsewhere } }, select: { userId: true, role: true } })).map((m) => [m.userId, m.role as string]))
    : new Map<string, string>();
  const managers = new Map<string, DigestManager>();
  for (const r of rows) {
    const level = r.organizationId === organizationId ? r.accessLevel : held.get(r.id);
    if (!level || isAgentOf(level) || RULE_1_DENIED_STATUSES.has(String(r.status))) continue;
    const ctx = nodeCtxFromLevel(r.id, organizationId, level);
    managers.set(r.id, {
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      viewer: { userId: ctx.userId, orgAdmin: ctx.orgAdmin, orgGuest: ctx.orgGuest, isAgent: ctx.isAgent, denied: false },
    });
  }
  for (const [personId, managerId] of effective) {
    const m = managerId && managerId !== personId ? managers.get(managerId) : undefined;
    if (m) out.set(personId, m);
  }
  return out;
}

/**
 * For each viewer, the ids of these Lists they hold at least Can view on:
 * one world for every List, one read of everyone's rows on it, and the rules
 * evaluated per viewer in memory. A List in another workspace is none.
 */
export async function listsEachCanRead(organizationId: string, viewers: readonly NodeViewer[], listIds: Iterable<string>): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(viewers.map((v) => [v.userId, new Set<string>()]));
  const lists = [...new Set(listIds)].filter(Boolean);
  if (lists.length === 0 || viewers.length === 0) return out;
  const rows = await loadRows(organizationId, { lists });
  const all = await loadAllGrants(rows);
  for (const v of viewers) {
    if (v.denied) continue;
    const ev = new NodeEvaluator(rows, grantsWithViewer(v, all.get(v.userId)));
    const mine = out.get(v.userId) as Set<string>;
    for (const id of lists) if (roleAtLeast(ev.effective({ kind: "list", id }).role, "VIEW")) mine.add(id);
  }
  return out;
}
