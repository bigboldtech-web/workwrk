// The handover: what happens to a person's work when they leave (access
// invariant 13, settings-architecture 5.5 "Transfer dialog", 5.9 SCIM).
//
// ONE implementation, three callers:
//   POST /api/users/[id]/handover   the Members transfer dialog and the
//                                   Directory's Remove, with the transferee
//                                   the admin picked
//   SCIM deprovisioning             unattended: the person's manager, else
//                                   the first Owner (no acting admin exists)
// and its report routing, a fourth: moving an Agent's stored reports off
// them (moveAgentReports, /api/users/[id]/agent-reports).
//
// What moves, in two transactions (docs-found fixes batch 4):
//   1. LINES, under the workspace's role lock and nothing else: their
//      direct reports (never into a reporting loop, and never to an Agent
//      or a deactivated person, who can manage nobody: a report that cannot
//      go to the recipient goes up the leaver's line to the first person who
//      can manage them now, live and no Agent, else to no manager;
//      reporting-lines.ts planReportHandover, which the transfer dialog's
//      preview reads too). The plan reads only the leaver's line facts
//      (handoverLinesFor), so the lock is held for a few small reads and
//      writes, never for a sweep of the workspace or of their tasks.
//   2. WORK, without the role lock: the Spaces, Folders and Lists they own
//      (ownerId), so no container is ever left with an owner who cannot sign
//      in, then their OPEN tasks (ownerId and assigneeIds[0], kept in step;
//      done work keeps its owner, history is never rewritten; a meeting's
//      hidden Item is no task and stays). Containers before tasks, the
//      order a Space delete locks them (trash.ts), so the two never deadlock.
// A busy role lock (OrgRolesBusy) stops the run before anything is written.
// Both halves only move what the leaver still holds, so a run that stopped
// half way is finished by running it again. Nothing is deleted.
// Server-only (prisma).

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { groupHandoverAssignees } from "@/lib/board-items-shared";
import { planReportHandover, type LineMap, type ManagerMap } from "@/lib/people/reporting-lines";
import { agentIdsIn } from "@/lib/access/manager-candidate";
import { lineFactsAround, managesNobody } from "@/lib/access/manager-lines";
import { lockOrgRoles } from "@/lib/access/membership";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { followReportingLine } from "@/lib/performance/review-cycle.server";

type Db = PrismaClient | Prisma.TransactionClient;

/** Same completion heuristic as /api/me/work: Item.status is a per-List free string. */
export function isOpenStatus(s?: string | null): boolean {
  return !/(done|complete|closed|resolved|shipped)/i.test(s ?? "");
}

export interface HandoverResult {
  tasksReassigned: number;
  reportsReassigned: number;
  containersReassigned: number;
  reportsRehomed: { id: string; name: string | null; managerId: string | null; managerName: string | null }[];
}

async function namesFor(ids: readonly (string | null)[]): Promise<(uid: string | null) => string | null> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = want.length ? await prisma.user.findMany({ where: { id: { in: want } }, select: { id: true, firstName: true, lastName: true } }) : [];
  return (uid) => {
    const u = uid ? rows.find((x) => x.id === uid) : null;
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null : null;
  };
}

/** The role-locked half: a few small reads and writes, so its own timeout is short and a waiter's bound (ORG_ROLES_WAIT_MS) sits well inside it. */
const LINES_TX = { timeout: 10_000, maxWait: 5_000 } as const;

export async function runHandover(input: { organizationId: string; fromId: string; toId: string; actorId: string | null }): Promise<HandoverResult> {
  const { organizationId: orgId, fromId: id, toId: reassignToId } = input;

  // 1. LINES, under the workspace's role lock (rule 6's race, docs-found
  // fixes batch 3): the report plan is read here, so a role change making
  // the recipient, or the manager above, an Agent waits for this (and then
  // counts the reports it moved) or lands first and is seen by the plan.
  const lines = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, orgId);
    const plan = await reportPlanFor(orgId, id, reassignToId, tx);
    for (const [up, ids] of plan.rehome) {
      await tx.user.updateMany({ where: { organizationId: orgId, managerId: id, deletedAt: null, id: { in: ids } }, data: { managerId: up } });
    }
    const reports = await tx.user.updateMany({ where: { organizationId: orgId, managerId: id, deletedAt: null, id: { in: plan.toRecipient } }, data: { managerId: reassignToId } });
    return { plan, reports: reports.count };
  }, LINES_TX);
  const { plan } = lines;

  // 2. WORK, without the role lock: containers first, then the open tasks.
  const items = await prisma.item.findMany({
    where: { organizationId: orgId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS },
    select: { id: true, status: true, assigneeIds: true },
  });
  const open = items.filter((it) => isOpenStatus(it.status));
  const openIds = open.map((it) => it.id);
  // ownerId IS assigneeIds[0]: the set is rewritten with the owner, or the
  // next unassign would promote the leaver back (handover route history).
  const bySet = groupHandoverAssignees(open, id, reassignToId);
  const work = await prisma.$transaction(async (tx) => {
    const spaces = await tx.space.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } });
    const folders = await tx.folder.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } });
    const lists = await tx.board.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } });
    const tasks = await tx.item.updateMany({ where: { id: { in: openIds } }, data: { ownerId: reassignToId } });
    for (const { assigneeIds, ids } of bySet) await tx.item.updateMany({ where: { id: { in: ids } }, data: { assigneeIds } });
    return { tasks: tasks.count, containers: spaces.count + folders.count + lists.count };
  }, { timeout: 60_000, maxWait: 10_000 });

  await followReportingLine(orgId, plan.reportIds, input.actorId ?? reassignToId).catch((e: unknown) => console.error("followReportingLine failed", e));

  const skipped = plan.reportIds.filter((r) => !plan.toRecipient.includes(r));
  const nameOf = await namesFor([...skipped, ...plan.rehome.keys()]);
  return {
    tasksReassigned: work.tasks,
    reportsReassigned: lines.reports,
    containersReassigned: work.containers,
    reportsRehomed: [...plan.rehome.entries()].flatMap(([up, ids]) => ids.map((rid) => ({ id: rid, name: nameOf(rid), managerId: up, managerName: nameOf(up) }))),
  };
}

/** The line facts the report plan reads, and no more (manager-lines.ts lineFactsAround). */
async function handoverLinesFor(organizationId: string, leaverId: string, recipientId: string, db: Db): Promise<{ people: LineMap; managers: ManagerMap; agentIds: Set<string> }> {
  const people = await lineFactsAround(organizationId, leaverId, [recipientId], db);
  const managers: ManagerMap = new Map([...people].map(([uid, p]) => [uid, p.managerId]));
  const agentIds = new Set([...people].filter(([, p]) => p.agent).map(([uid]) => uid));
  return { people, managers, agentIds };
}

/**
 * The report half of the handover, as runHandover will run it: the leaver's
 * reports, who goes to the recipient, and where the rest go. An Agent
 * recipient takes the work but never the reports (access 2.4). The rest go
 * up the leaver's line to the first person who can manage them now: never an
 * Agent, never someone deactivated or removed (reporting-lines.ts
 * liveManagerFrom), else to no manager.
 */
async function reportPlanFor(organizationId: string, fromId: string, toId: string, db: Db = prisma) {
  const { people, managers, agentIds } = await handoverLinesFor(organizationId, fromId, toId, db);
  // A recipient anchored in another workspace (an Owner who works here
  // through a membership) is not in this workspace's lines: asked directly,
  // at the tier they hold here.
  const recipientIsAgent = people.has(toId) ? agentIds.has(toId) : (await agentIdsIn(organizationId, [toId], db)).has(toId);
  // A deactivated recipient takes no reports either (invariant 13: a
  // deactivated person holds none); the route refuses one as a recipient.
  const recipientInactive = people.has(toId)
    ? people.get(toId)!.inactive
    : (await db.user.findUnique({ where: { id: toId }, select: { status: true } }))?.status === "INACTIVE";
  return { ...planReportHandover({ leaverId: fromId, recipientId: toId, recipientIsAgent, recipientInactive, managers, agentIds, people }), recipientIsAgent };
}

/**
 * What a handover to `toId` would do with the leaver's direct reports, for
 * the transfer dialog to say before it runs (GET /api/users/[id]/handover
 * ?to=): how many there are, whether the recipient is an Agent, and where
 * those who do not go to the recipient land, by name.
 */
export async function previewReportHandover(organizationId: string, fromId: string, toId: string): Promise<{
  reports: number;
  toRecipient: number;
  recipientIsAgent: boolean;
  rehomed: { to: string | null; count: number }[];
}> {
  const plan = await reportPlanFor(organizationId, fromId, toId);
  const nameOf = await namesFor([...plan.rehome.keys()]);
  return {
    reports: plan.reportIds.length,
    toRecipient: plan.toRecipient.length,
    recipientIsAgent: plan.recipientIsAgent,
    rehomed: [...plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), count: rs.length })),
  };
}

// ── An Agent who still has people listed under them ─────────────────
//
// An Agent is never anyone's manager (AGENT_TIER_BLURB). People listed
// under one before rule 6 are already read as reporting to the next manager
// up (src/lib/access/manager-lines.ts); these two let an Admin make the
// stored lines say so (the Members drawer, /api/users/[id]/agent-reports).
// The solid reports take the handover's own routing, as if the Agent were
// leaving with an Agent as recipient: up the Agent's line to the first
// person who can manage them, else no manager. A dotted line to an Agent
// gives nobody reach, so it is taken off, never handed up.

export interface AgentReportsPlan {
  agent: boolean;
  solid: number;
  dotted: number;
  /** Where the solid reports go, by name; null is "no manager". */
  rehomed: { to: string | null; toId: string | null; count: number }[];
}

async function agentPlanFor(organizationId: string, agentId: string, db: Db) {
  // The Agent tier they hold in this workspace (manager-lines.ts managesNobody).
  if (!(await managesNobody(agentId, organizationId, db))) return null;
  const { people, managers, agentIds } = await handoverLinesFor(organizationId, agentId, agentId, db);
  const plan = planReportHandover({ leaverId: agentId, recipientId: agentId, recipientIsAgent: true, managers, agentIds, people });
  const dotted = await db.userDottedLine.findMany({
    where: { managerId: agentId, userId: { not: agentId }, user: { organizationId, deletedAt: null } },
    select: { userId: true },
  });
  return { plan, dottedIds: dotted.map((d) => d.userId) };
}

export async function previewAgentReports(organizationId: string, agentId: string): Promise<AgentReportsPlan> {
  const found = await agentPlanFor(organizationId, agentId, prisma);
  if (!found) return { agent: false, solid: 0, dotted: 0, rehomed: [] };
  const nameOf = await namesFor([...found.plan.rehome.keys()]);
  return {
    agent: true,
    solid: found.plan.reportIds.length,
    dotted: found.dottedIds.length,
    rehomed: [...found.plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), toId: up, count: rs.length })),
  };
}

/**
 * Move an Agent's stored reports off them, under the role lock: the solid
 * reports up their line (previewAgentReports says where), and the dotted
 * lines to them taken off. Null when the person is no Agent (nothing moved).
 */
/**
 * Is the plan under the lock still the plan the caller was shown (the same
 * counts, and the same number of direct reports going to each person)? A
 * move only runs what the drawer said it would.
 */
export function samePlan(
  shown: Pick<AgentReportsPlan, "solid" | "dotted" | "rehomed">,
  now: { solid: number; dotted: number; rehome: ReadonlyMap<string | null, readonly string[]> },
): boolean {
  if (shown.solid !== now.solid || shown.dotted !== now.dotted) return false;
  const want = new Map<string | null, number>();
  for (const r of shown.rehomed) if (r.count > 0) want.set(r.toId, (want.get(r.toId) ?? 0) + r.count);
  const got = new Map<string | null, number>();
  for (const [to, ids] of now.rehome) if (ids.length > 0) got.set(to, ids.length);
  return want.size === got.size && [...want].every(([to, n]) => got.get(to) === n);
}

export async function moveAgentReports(input: {
  organizationId: string;
  agentId: string;
  actorId: string;
  /** The plan the caller was shown (previewAgentReports); when given, nothing moves unless it still holds. */
  expect?: Pick<AgentReportsPlan, "solid" | "dotted" | "rehomed"> | null;
}): Promise<
  | { moved: number; dottedRemoved: number; rehomed: { to: string | null; toId: string | null; count: number }[] }
  | { changed: true }
  | null
> {
  const { organizationId: orgId, agentId } = input;
  const done = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, orgId);
    const found = await agentPlanFor(orgId, agentId, tx);
    if (!found) return null;
    if (input.expect && !samePlan(input.expect, { solid: found.plan.reportIds.length, dotted: found.dottedIds.length, rehome: found.plan.rehome })) {
      return { changed: true as const };
    }
    let moved = 0;
    for (const [up, ids] of found.plan.rehome) {
      const r = await tx.user.updateMany({ where: { organizationId: orgId, managerId: agentId, deletedAt: null, id: { in: ids } }, data: { managerId: up } });
      moved += r.count;
    }
    const dotted = found.dottedIds.length
      ? await tx.userDottedLine.deleteMany({ where: { managerId: agentId, userId: { in: found.dottedIds } } })
      : { count: 0 };
    return { plan: found.plan, moved, dottedRemoved: dotted.count };
  }, LINES_TX);
  if (!done) return null;
  if (done.changed) return { changed: true };
  await followReportingLine(orgId, done.plan.reportIds, input.actorId).catch((e: unknown) => console.error("followReportingLine failed", e));
  const nameOf = await namesFor([...done.plan.rehome.keys()]);
  return {
    moved: done.moved,
    dottedRemoved: done.dottedRemoved,
    rehomed: [...done.plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), toId: up, count: rs.length })),
  };
}

export { unattendedRecipient, wouldRemoveLastOwner } from "@/lib/access/membership";

/**
 * What a deactivation would leave behind without a handover: open tasks the
 * person owns, people who report to them, and Spaces, Folders and Lists they
 * own (the same three runHandover moves and the Members transfer dialog
 * counts). PATCH /api/users/[id] refuses { status: "INACTIVE" } while any is
 * non-zero, so no route can orphan a leaver's work (invariant 13): every UI
 * path runs POST /api/users/[id]/handover first, which empties all three.
 */
export async function pendingHandover(organizationId: string, id: string): Promise<{ openTasks: number; directReports: number; containers: number }> {
  const [items, reports, spaces, folders, boards] = await Promise.all([
    // A meeting's hidden Item is no task (system-items.ts): never counted, never moved.
    prisma.item.findMany({ where: { organizationId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS }, select: { status: true } }),
    prisma.user.count({ where: { organizationId, managerId: id, deletedAt: null } }),
    prisma.space.count({ where: { organizationId, ownerId: id } }),
    prisma.folder.count({ where: { organizationId, ownerId: id } }),
    prisma.board.count({ where: { organizationId, ownerId: id } }),
  ]);
  return { openTasks: items.filter((it) => isOpenStatus(it.status)).length, directReports: reports, containers: spaces + folders + boards };
}
