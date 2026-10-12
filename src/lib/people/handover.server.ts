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
//      A report is anyone who holds a level here, anchored here or through
//      a membership (batch 5), so a report who last switched to another
//      workspace is moved too, never left under someone who has left.
//      A workspace moves only the lines it owns (batch 6): User.managerId is
//      one column every workspace the report belongs to reads, so a report
//      who also works with the leaver in another workspace, where the leaver
//      is still their manager (no Agent there), stays as they are. The plan,
//      the preview and the result name them (`stays`), and the deactivation
//      gate (pendingHandover) does not count them.
//      Each move is logged (reporting_line_changed) IN this transaction, so
//      the record of who went where commits with the moves and can never be
//      lost to a later failure (batch 5), and open reviews follow the new
//      lines (followReportingLine) as soon as it commits, before WORK.
//   2. WORK, without the role lock: the Spaces, Folders and Lists they own
//      (ownerId), so no container is ever left with an owner who cannot sign
//      in, then their OPEN tasks (ownerId and assigneeIds[0], kept in step;
//      done work keeps its owner, history is never rewritten; a meeting's
//      hidden Item is no task and stays). Containers before tasks, the
//      order a Space delete locks them (trash.ts), so the two never deadlock.
//      The tasks are read and locked (FOR UPDATE, in id order) inside this
//      transaction, and each write is conditioned on the leaver still owning
//      the task (batch 5): a task someone reassigned meanwhile is never
//      taken back, and an assignee set is rewritten from what it holds now,
//      so no change made in between is lost. Only what moved is counted.
// A busy role lock (OrgRolesBusy) stops the run before anything is written.
// A WORK failure after LINES committed throws HandoverWorkFailed, which says
// the reports moved and the work did not, so neither the admin nor the
// identity provider is told a bare 500 (batch 5).
// Both halves only move what the leaver still holds, so a run that stopped
// half way is finished by running it again. Nothing is deleted.
// Server-only (prisma).

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { groupHandoverAssignees } from "@/lib/board-items-shared";
import { planReportHandover, type LineMap, type ManagerMap } from "@/lib/people/reporting-lines";
import { agentIdsIn } from "@/lib/access/manager-candidate";
import { lineKey, linesElsewhere } from "@/lib/access/acting-workspace";
import { lineFactsAround, liveHereAmong, managesNobody } from "@/lib/access/manager-lines";
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
  /** Reports left under the leaver: another workspace relies on that line (batch 6). */
  reportsStaying: { id: string; name: string | null }[];
}

/** What LINES moved and recorded before WORK failed. */
export type HandoverLinesDone = Pick<HandoverResult, "reportsReassigned" | "reportsRehomed" | "reportsStaying"> & {
  /** Every direct report moved, to the recipient or up the line. */
  reportsMoved: number;
};

/**
 * The reports moved (LINES committed, with its audit rows), but the work did
 * not: WORK failed, a timeout, a deadlock or a dropped connection. Running
 * the handover again moves the rest (both halves move only what the leaver
 * still holds); the reports' moves are already in the Audit log.
 */
export class HandoverWorkFailed extends Error {
  readonly code = "handover_partial";
  constructor(readonly lines: HandoverLinesDone, readonly reason: unknown) {
    super(handoverPartialWords(lines));
    this.name = "HandoverWorkFailed";
  }
}

export function isHandoverWorkFailed(e: unknown): e is HandoverWorkFailed {
  return e instanceof HandoverWorkFailed || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "HandoverWorkFailed");
}

/**
 * What the person is told when the reports moved and the work did not (pure).
 * With no report moved it names only the work: most leavers have no reports,
 * so "their direct reports were already moved" was untrue for them (batch 6).
 */
export function handoverPartialWords(lines: Pick<HandoverLinesDone, "reportsMoved">): string {
  const rest = "their open tasks and their Spaces, Folders and Lists";
  if (lines.reportsMoved === 0) return `Their open tasks and their Spaces, Folders and Lists didn't move. Try again to move them.`;
  const who = lines.reportsMoved === 1 ? "Their direct report moved" : `Their ${lines.reportsMoved} direct reports moved`;
  return `${who}, but ${rest} didn't. Try again to move the rest.`;
}

type Names = (uid: string | null) => string | null;

async function namesFor(ids: readonly (string | null)[], db: Db = prisma): Promise<Names> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = want.length ? await db.user.findMany({ where: { id: { in: want } }, select: { id: true, firstName: true, lastName: true } }) : [];
  return (uid) => {
    const u = uid ? rows.find((x) => x.id === uid) : null;
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null : null;
  };
}

/** One task as WORK reads it under its row lock. */
type LockedItem = { id: string; ownerId: string | null; status: string | null; assigneeIds: string[] | null; archivedAt: Date | null };

/** The role-locked half: a few small reads and writes, so its own timeout is short and a waiter's bound (ORG_ROLES_WAIT_MS) sits well inside it. */
const LINES_TX = { timeout: 10_000, maxWait: 5_000 } as const;

export async function runHandover(input: {
  organizationId: string;
  fromId: string;
  toId: string;
  actorId: string | null;
  /** Who acted when no person did (SCIM: "scim", "Identity provider"), for the audit rows. */
  actorType?: string;
  actorLabel?: string;
}): Promise<HandoverResult> {
  const { organizationId: orgId, fromId: id, toId: reassignToId } = input;

  // 1. LINES, under the workspace's role lock (rule 6's race, docs-found
  // fixes batch 3): the report plan is read here, so a role change making
  // the recipient, or the manager above, an Agent waits for this (and then
  // counts the reports it moved) or lands first and is seen by the plan.
  // The moves are logged in the same transaction (batch 5).
  const lines = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, orgId);
    const plan = await reportPlanFor(orgId, id, reassignToId, tx);
    const moves: Array<{ to: string | null; ids: string[]; count: number }> = [];
    for (const [up, ids] of plan.rehome) {
      const r = await tx.user.updateMany({ where: { managerId: id, deletedAt: null, id: { in: ids } }, data: { managerId: up } });
      moves.push({ to: up, ids, count: r.count });
    }
    const reports = await tx.user.updateMany({ where: { managerId: id, deletedAt: null, id: { in: plan.toRecipient } }, data: { managerId: reassignToId } });
    moves.push({ to: reassignToId, ids: plan.toRecipient, count: reports.count });
    // Every write of a reporting line takes this lock, so the plan read under
    // it is what moved. Should a count ever differ, the rows say who moved:
    // the audit names only people really moved.
    for (const m of moves) {
      if (m.count > 0 && m.count !== m.ids.length) {
        m.ids = (await tx.user.findMany({ where: { id: { in: m.ids }, managerId: m.to }, select: { id: true } })).map((u) => u.id);
      }
    }
    const moved = moves.filter((m) => m.count > 0 && m.ids.length > 0);
    const nameOf = await namesFor([id, ...plan.reportIds, ...plan.stays, ...plan.rehome.keys(), reassignToId], tx);
    if (moved.length > 0) {
      await tx.activityLog.createMany({ data: moved.flatMap((m) => m.ids.map((rid) => lineMoveRow(input, rid, m.to, nameOf))) });
    }
    return { plan, reports: reports.count, moved: moved.reduce((n, m) => n + m.count, 0), nameOf };
  }, LINES_TX);
  const { plan, nameOf } = lines;

  // Open reviews follow the new lines now, whatever WORK does next.
  await followReportingLine(orgId, plan.reportIds, input.actorId ?? reassignToId).catch((e: unknown) => console.error("followReportingLine failed", e));

  const reportsRehomed = [...plan.rehome.entries()].flatMap(([up, ids]) => ids.map((rid) => ({ id: rid, name: nameOf(rid), managerId: up, managerName: nameOf(up) })));
  const reportsStaying = plan.stays.map((rid) => ({ id: rid, name: nameOf(rid) }));
  const linesDone: HandoverLinesDone = { reportsReassigned: lines.reports, reportsRehomed, reportsStaying, reportsMoved: lines.moved };

  // 2. WORK, without the role lock: containers first, then the open tasks,
  // read and locked here so nothing changed in between is overwritten.
  let work: { tasks: number; containers: number };
  try {
    work = await prisma.$transaction(async (tx) => {
      const spaces = await tx.space.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } });
      const folders = await tx.folder.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } });
      const lists = await tx.board.updateMany({ where: { organizationId: orgId, ownerId: id }, data: { ownerId: reassignToId } });
      const candidates = await tx.item.findMany({
        where: { organizationId: orgId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS },
        select: { id: true },
      });
      const ids = candidates.map((c) => c.id);
      // FOR UPDATE waits for an edit in flight and then reads what it left,
      // in id order (the order trash.ts locks tasks in).
      const locked = ids.length
        ? await tx.$queryRaw<LockedItem[]>`SELECT id, "ownerId", status, "assigneeIds", "archivedAt" FROM "Item" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`
        : [];
      const open = locked.filter((it) => it.ownerId === id && it.archivedAt == null && isOpenStatus(it.status));
      // ownerId IS assigneeIds[0]: the set is rewritten with the owner, in
      // one statement, or the next unassign would promote the leaver back
      // (handover route history). Each write holds only while the leaver
      // still owns the task.
      let tasks = 0;
      for (const { assigneeIds, ids: group } of groupHandoverAssignees(open, id, reassignToId)) {
        const r = await tx.item.updateMany({ where: { id: { in: group }, ownerId: id }, data: { ownerId: reassignToId, assigneeIds } });
        tasks += r.count;
      }
      return { tasks, containers: spaces.count + folders.count + lists.count };
    }, { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    console.error("handover WORK failed after the reports moved", e);
    throw new HandoverWorkFailed(linesDone, e);
  }

  return {
    tasksReassigned: work.tasks,
    reportsReassigned: lines.reports,
    containersReassigned: work.containers,
    reportsRehomed,
    reportsStaying,
  };
}

/** The audit row for one direct report the handover moved: whose line changed, from the leaver to whom. */
function lineMoveRow(
  input: { organizationId: string; fromId: string; actorId: string | null; actorType?: string; actorLabel?: string },
  reportId: string,
  to: string | null,
  nameOf: Names,
) {
  const who = nameOf(reportId) ?? "Someone";
  const leaver = nameOf(input.fromId) ?? "the person leaving";
  return {
    type: "reporting_line_changed",
    actorId: input.actorId,
    organizationId: input.organizationId,
    description: to ? `Moved ${who} from ${leaver} to ${nameOf(to) ?? "a new manager"} in a handover` : `Moved ${who} from ${leaver} to no manager in a handover`,
    targetId: reportId,
    targetType: "user",
    severity: "info",
    oldValue: { managerId: input.fromId },
    newValue: { managerId: to },
    metadata: { handover: true, leaverId: input.fromId },
    ...(input.actorType ? { actorType: input.actorType } : {}),
    ...(input.actorLabel ? { actorLabel: input.actorLabel } : {}),
  };
}

/**
 * The line facts the report plan reads, and no more (manager-lines.ts
 * lineFactsAround), and the reports whose line to `leaverId` another
 * workspace relies on (`stays`, batch 6), which this workspace never moves.
 */
async function handoverLinesFor(
  organizationId: string,
  leaverId: string,
  recipientId: string,
  db: Db,
): Promise<{ people: LineMap; managers: ManagerMap; agentIds: Set<string>; stays: Set<string> }> {
  const people = await lineFactsAround(organizationId, leaverId, [recipientId], db);
  const managers: ManagerMap = new Map([...people].map(([uid, p]) => [uid, p.managerId]));
  const agentIds = new Set([...people].filter(([, p]) => p.agent).map(([uid]) => uid));
  const reports = [...people].filter(([uid, p]) => p.managerId === leaverId && uid !== leaverId).map(([uid]) => uid);
  const stays = await reportsStayingWith(organizationId, leaverId, reports, db);
  return { people, managers, agentIds, stays };
}

/**
 * Of these direct reports of `managerId`, the ones whose line another
 * workspace relies on: they also work there, and `managerId` holds a level
 * there that is not the Agent tier (acting-workspace.ts linesElsewhere). The
 * line is that workspace's too, so the handover and the Agent move leave it.
 */
async function reportsStayingWith(organizationId: string, managerId: string, reportIds: readonly string[], db: Db): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  const there = await linesElsewhere(organizationId, reportIds.map((personId) => ({ personId, managerId })), db);
  return new Set(reportIds.filter((personId) => there.get(lineKey({ personId, managerId })) === "relied"));
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
  const { people, managers, agentIds, stays } = await handoverLinesFor(organizationId, fromId, toId, db);
  // A recipient anchored in another workspace (an Owner who works here
  // through a membership) is not in this workspace's lines: asked directly,
  // at the tier they hold here.
  const recipientIsAgent = people.has(toId) ? agentIds.has(toId) : (await agentIdsIn(organizationId, [toId], db)).has(toId);
  // A deactivated recipient takes no reports either (invariant 13: a
  // deactivated person holds none); the route refuses one as a recipient.
  const recipientInactive = people.has(toId)
    ? people.get(toId)!.inactive
    : (await db.user.findUnique({ where: { id: toId }, select: { status: true } }))?.status === "INACTIVE";
  return { ...planReportHandover({ leaverId: fromId, recipientId: toId, recipientIsAgent, recipientInactive, managers, agentIds, people, stays }), recipientIsAgent };
}

/**
 * What a handover to `toId` would do with the leaver's direct reports, for
 * the transfer dialog to say before it runs (GET /api/users/[id]/handover
 * ?to=): how many move, whether the recipient is an Agent, where those who
 * do not go to the recipient land, by name, and who stays, by name (batch 6:
 * another workspace relies on their line).
 */
export async function previewReportHandover(organizationId: string, fromId: string, toId: string): Promise<{
  reports: number;
  toRecipient: number;
  recipientIsAgent: boolean;
  rehomed: { to: string | null; count: number }[];
  stays: { id: string; name: string | null }[];
}> {
  const plan = await reportPlanFor(organizationId, fromId, toId);
  const nameOf = await namesFor([...plan.rehome.keys(), ...plan.stays]);
  return {
    reports: plan.reportIds.length,
    toRecipient: plan.toRecipient.length,
    recipientIsAgent: plan.recipientIsAgent,
    rehomed: [...plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), count: rs.length })),
    stays: plan.stays.map((rid) => ({ id: rid, name: nameOf(rid) })),
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
// Only the lines this workspace owns move (batch 6): a person who also works
// with the Agent in another workspace, where the Agent is no Agent and is
// still their manager or dotted-line manager, keeps that line, and the
// drawer names them (`stays`).

export interface AgentReportsPlan {
  agent: boolean;
  /** Direct reports that move. */
  solid: number;
  /** Dotted lines taken off. */
  dotted: number;
  /** Where the solid reports go, by name; null is "no manager". */
  rehomed: { to: string | null; toId: string | null; count: number }[];
  /** People whose line to the Agent another workspace relies on: they stay as they are. */
  stays: { id: string; name: string | null; kind: "solid" | "dotted" }[];
}

async function agentPlanFor(organizationId: string, agentId: string, db: Db) {
  // The Agent tier they hold in this workspace (manager-lines.ts managesNobody).
  if (!(await managesNobody(agentId, organizationId, db))) return null;
  const { people, managers, agentIds, stays } = await handoverLinesFor(organizationId, agentId, agentId, db);
  const plan = planReportHandover({ leaverId: agentId, recipientId: agentId, recipientIsAgent: true, managers, agentIds, people, stays });
  // The dotted lines to them from people of this workspace (batch 5: a
  // person who works here through a membership too).
  const dotted = await db.userDottedLine.findMany({
    where: { managerId: agentId, userId: { not: agentId }, user: { deletedAt: null } },
    select: { userId: true },
  });
  const here = await liveHereAmong(organizationId, dotted.map((d) => d.userId), db);
  const dottedHere = [...new Set(dotted.map((d) => d.userId))].filter((uid) => here.has(uid));
  const dottedStay = await reportsStayingWith(organizationId, agentId, dottedHere, db);
  return { plan, dottedIds: dottedHere.filter((uid) => !dottedStay.has(uid)), dottedStays: dottedHere.filter((uid) => dottedStay.has(uid)) };
}

async function agentStaysNamed(found: { plan: { stays: string[] }; dottedStays: string[] }, db: Db = prisma): Promise<AgentReportsPlan["stays"]> {
  const nameOf = await namesFor([...found.plan.stays, ...found.dottedStays], db);
  return [
    ...found.plan.stays.map((id) => ({ id, name: nameOf(id), kind: "solid" as const })),
    ...found.dottedStays.map((id) => ({ id, name: nameOf(id), kind: "dotted" as const })),
  ];
}

export async function previewAgentReports(organizationId: string, agentId: string): Promise<AgentReportsPlan> {
  const found = await agentPlanFor(organizationId, agentId, prisma);
  if (!found) return { agent: false, solid: 0, dotted: 0, rehomed: [], stays: [] };
  const nameOf = await namesFor([...found.plan.rehome.keys()]);
  return {
    agent: true,
    solid: found.plan.reportIds.length,
    dotted: found.dottedIds.length,
    rehomed: [...found.plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), toId: up, count: rs.length })),
    stays: await agentStaysNamed(found),
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
  | { moved: number; dottedRemoved: number; rehomed: { to: string | null; toId: string | null; count: number }[]; stays: AgentReportsPlan["stays"] }
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
      const r = await tx.user.updateMany({ where: { managerId: agentId, deletedAt: null, id: { in: ids } }, data: { managerId: up } });
      moved += r.count;
    }
    const dotted = found.dottedIds.length
      ? await tx.userDottedLine.deleteMany({ where: { managerId: agentId, userId: { in: found.dottedIds } } })
      : { count: 0 };
    return { plan: found.plan, moved, dottedRemoved: dotted.count, dottedStays: found.dottedStays };
  }, LINES_TX);
  if (!done) return null;
  if (done.changed) return { changed: true };
  await followReportingLine(orgId, done.plan.reportIds, input.actorId).catch((e: unknown) => console.error("followReportingLine failed", e));
  const nameOf = await namesFor([...done.plan.rehome.keys()]);
  return {
    moved: done.moved,
    dottedRemoved: done.dottedRemoved,
    rehomed: [...done.plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), toId: up, count: rs.length })),
    stays: await agentStaysNamed(done),
  };
}

export { unattendedRecipient, wouldRemoveLastOwner } from "@/lib/access/membership";

/**
 * The direct reports a handover of `id` moves: everyone stored under them who
 * holds a level here (batch 5), anchored here or through a membership, less
 * those whose line another workspace relies on (batch 6), which it leaves.
 * `db` is the caller's transaction when the count must hold under the role
 * lock (PATCH's deactivation gate).
 */
export async function handoverReportCount(organizationId: string, id: string, db: Db = prisma): Promise<number> {
  const rows = await db.user.findMany({ where: { managerId: id, deletedAt: null }, select: { id: true } });
  const here = [...(await liveHereAmong(organizationId, rows.map((r) => r.id), db))];
  const stays = await reportsStayingWith(organizationId, id, here.filter((rid) => rid !== id), db);
  return here.filter((rid) => !stays.has(rid)).length;
}

/**
 * What a deactivation would leave behind without a handover: open tasks the
 * person owns, people who report to them, and Spaces, Folders and Lists they
 * own (the same three runHandover moves and the Members transfer dialog
 * counts). PATCH /api/users/[id] refuses { status: "INACTIVE" } while any is
 * non-zero, so no route can orphan a leaver's work (invariant 13): every UI
 * path runs POST /api/users/[id]/handover first, which empties all three.
 * A report whose line another workspace relies on is not counted: the
 * handover leaves it (batch 6), so counting it would block the deactivation
 * for good.
 */
export async function pendingHandover(organizationId: string, id: string): Promise<{ openTasks: number; directReports: number; containers: number }> {
  const [items, reports, spaces, folders, boards] = await Promise.all([
    // A meeting's hidden Item is no task (system-items.ts): never counted, never moved.
    prisma.item.findMany({ where: { organizationId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS }, select: { status: true } }),
    handoverReportCount(organizationId, id),
    prisma.space.count({ where: { organizationId, ownerId: id } }),
    prisma.folder.count({ where: { organizationId, ownerId: id } }),
    prisma.board.count({ where: { organizationId, ownerId: id } }),
  ]);
  return { openTasks: items.filter((it) => isOpenStatus(it.status)).length, directReports: reports, containers: spaces + folders + boards };
}
