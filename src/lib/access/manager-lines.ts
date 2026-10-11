// "An Agent is never anyone's manager" (access 2.4, AGENT_TIER_BLURB) for
// the reporting lines that already say otherwise. Rule 6 (membership.ts)
// stops a manager becoming an Agent while anyone reports to them, but people
// who were Agents before it, and the reports and dotted lines they kept, are
// still stored. Nothing here rewrites them (docs-found fixes batch 3: no
// blind change of stored rows). Every read that grants reach asks here
// instead, so the stored line is read as the sentence promises:
//
//   An Agent's own reach   none. Their report tree is empty, they have no
//                          direct or dotted reports, and they are nobody's
//                          manager reviewer or approver (managesNobody).
//   Their solid reports    report, in effect, to the next person up the line
//                          who is no Agent (reporting-lines.ts
//                          effectiveManagerFrom), or to nobody. That person
//                          already reaches them through the tree.
//   Their dotted lines     count for nobody. A dotted line is a named extra
//                          relationship, so it is never handed up the line:
//                          that would give someone reach the line never gave.
//
// An Admin sees the stored lines on the Members drawer and can move them
// (/api/users/[id]/agent-reports, the handover's own report routing).
//
// Kept inside src/lib/access because the tier is the engine's to read (the
// G7 lint rule). Server-only (prisma).

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";
import { effectiveManagerFrom, type LineFacts } from "@/lib/people/reporting-lines";

type Db = PrismaClient | Prisma.TransactionClient;

/** How many rounds a walk through Agents reads before it stops (a chain of Agents longer than this is a data fault). */
const ROUNDS = 16;

/**
 * Does this person hold the Agent tier on their own row? Then they manage
 * nobody, whatever lines name them. Reporting lines live on that row (its
 * workspace), so the row's tier is the one that counts.
 */
export async function managesNobody(userId: string, db: Db = prisma): Promise<boolean> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { accessLevel: true } });
  return !!row && isAgentOf(row.accessLevel);
}

/** Every person of the workspace who is not removed, with what the walks up a line read. */
export async function lineMapFor(organizationId: string, db: Db = prisma): Promise<Map<string, LineFacts>> {
  const rows = await db.user.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, managerId: true, accessLevel: true, status: true },
  });
  return new Map(rows.map((r) => [r.id, { managerId: r.managerId, agent: isAgentOf(r.accessLevel), inactive: r.status === "INACTIVE" }]));
}

/**
 * The manager each of these people reports to for every read that grants
 * reach (effectiveManagerFrom): their stored manager, or past an Agent the
 * next person up who is none, or null. People not in this workspace are
 * left out of the answer. Reads only the managers it walks through.
 */
export async function effectiveManagersOf(organizationId: string, userIds: readonly string[], db: Db = prisma): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const people = await db.user.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, managerId: true } });
  const facts = new Map<string, LineFacts>();
  let frontier = [...new Set(people.map((p) => p.managerId).filter((m): m is string => !!m))];
  for (let round = 0; round < ROUNDS && frontier.length; round += 1) {
    const got = await db.user.findMany({
      where: { id: { in: frontier }, organizationId, deletedAt: null },
      select: { id: true, managerId: true, accessLevel: true, status: true },
    });
    for (const g of got) facts.set(g.id, { managerId: g.managerId, agent: isAgentOf(g.accessLevel), inactive: g.status === "INACTIVE" });
    frontier = [...new Set(got.filter((g) => isAgentOf(g.accessLevel) && g.managerId && !facts.has(g.managerId)).map((g) => g.managerId as string))];
  }
  return new Map(people.map((p) => [p.id, effectiveManagerFrom(p.managerId, facts)]));
}

/** One person's manager for every read that grants reach (effectiveManagersOf). */
export async function effectiveManagerOf(organizationId: string, userId: string, db: Db = prisma): Promise<string | null> {
  return (await effectiveManagersOf(organizationId, [userId], db)).get(userId) ?? null;
}

/**
 * The people whose manager, read that way, is `managerId`: their stored
 * reports, and the reports of any Agent among them (through Agents, any
 * depth). Nobody for an Agent. Removed people are left out, as the stored
 * direct-report reads always did.
 */
export async function effectiveDirectReportIds(organizationId: string, managerId: string, db: Db = prisma): Promise<string[]> {
  if (await managesNobody(managerId, db)) return [];
  const out = new Set<string>();
  const walked = new Set<string>([managerId]);
  let frontier = [managerId];
  for (let round = 0; round < ROUNDS && frontier.length; round += 1) {
    const kids = await db.user.findMany({
      where: { organizationId, managerId: { in: frontier }, deletedAt: null },
      select: { id: true, accessLevel: true },
    });
    const next: string[] = [];
    for (const k of kids) {
      if (k.id === managerId) continue;
      out.add(k.id);
      if (isAgentOf(k.accessLevel) && !walked.has(k.id)) {
        walked.add(k.id);
        next.push(k.id);
      }
    }
    frontier = next;
  }
  return [...out];
}

/**
 * The people listed under an Agent's direct reports (the "lifted" part of
 * effectiveDirectReportIds): reports of `managerId`'s Agent reports, at any
 * depth of Agents. Empty for an Agent or someone with no Agent reports.
 */
export async function reportsThroughAgents(organizationId: string, managerId: string, db: Db = prisma): Promise<string[]> {
  const all = await effectiveDirectReportIds(organizationId, managerId, db);
  if (all.length === 0) return [];
  const stored = await db.user.findMany({ where: { organizationId, managerId, deletedAt: null }, select: { id: true } });
  const own = new Set(stored.map((s) => s.id));
  return all.filter((id) => !own.has(id));
}

/**
 * The dotted reports that count for `managerId`: none for an Agent, else
 * every person who has a dotted line to them and is not removed.
 */
export async function countedDottedReportIds(organizationId: string, managerId: string, db: Db = prisma): Promise<string[]> {
  if (await managesNobody(managerId, db)) return [];
  const rows = await db.userDottedLine.findMany({ where: { managerId, user: { organizationId, deletedAt: null } }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId))].filter((id) => id !== managerId);
}

/**
 * The dotted-line managers of `userId` who count: none who hold the Agent
 * tier or are removed.
 */
export async function countedDottedManagerIds(organizationId: string, userId: string, db: Db = prisma): Promise<string[]> {
  const rows = await db.userDottedLine.findMany({
    where: { userId, manager: { organizationId, deletedAt: null } },
    select: { managerId: true, manager: { select: { accessLevel: true } } },
  });
  return [...new Set(rows.filter((r) => !isAgentOf(r.manager.accessLevel)).map((r) => r.managerId))];
}

/**
 * A Prisma User filter for "holds the Agent tier", for a row whose stored
 * approver or recorded manager is an Agent (a timesheet's approver named
 * before rule 6): that row waits for the manager above, as an unclaimed one.
 */
export const AGENT_APPROVER = { accessLevel: "AGENT" } as const satisfies Prisma.UserWhereInput;

/**
 * What an Admin is shown for an Agent who still has people listed under them
 * (the Members drawer): live solid reports and live dotted reports, each
 * person once per kind. Zeros for anyone who is no Agent.
 */
export async function agentStoredReports(organizationId: string, agentId: string, db: Db = prisma): Promise<{ solid: number; dotted: number }> {
  if (!(await managesNobody(agentId, db))) return { solid: 0, dotted: 0 };
  const [solid, dotted] = await Promise.all([
    db.user.count({ where: { organizationId, managerId: agentId, deletedAt: null, id: { not: agentId } } }),
    db.userDottedLine.count({ where: { managerId: agentId, userId: { not: agentId }, user: { organizationId, deletedAt: null } } }),
  ]);
  return { solid, dotted };
}

/** The Agents among these people who still have live solid or dotted reports, with how many of each. */
export async function agentsWithStoredReports(
  organizationId: string,
  ids: readonly string[],
  db: Db = prisma,
): Promise<Map<string, { solid: number; dotted: number }>> {
  const agents = ids.length
    ? await db.user.findMany({ where: { id: { in: [...ids] }, organizationId, accessLevel: "AGENT" }, select: { id: true } })
    : [];
  const agentIds = agents.map((a) => a.id);
  if (agentIds.length === 0) return new Map();
  const [solid, dotted] = await Promise.all([
    db.user.groupBy({ by: ["managerId"], where: { organizationId, managerId: { in: agentIds }, deletedAt: null }, _count: { _all: true } }),
    db.userDottedLine.groupBy({ by: ["managerId"], where: { managerId: { in: agentIds }, user: { organizationId, deletedAt: null } }, _count: { _all: true } }),
  ]);
  const out = new Map<string, { solid: number; dotted: number }>();
  for (const s of solid) if (s.managerId) out.set(s.managerId, { solid: s._count._all, dotted: 0 });
  for (const d of dotted) out.set(d.managerId, { solid: out.get(d.managerId)?.solid ?? 0, dotted: d._count._all });
  return out;
}
