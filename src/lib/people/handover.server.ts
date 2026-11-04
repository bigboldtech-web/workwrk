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
//      THE LINES ARE THIS WORKSPACE'S (docs/plans/workspace-status-2.md E1,
//      E4, E6, step 4). A report here is anyone whose line HERE names the
//      leaver: the account's line for someone anchored here, the
//      membership's for someone here through one (reportsHereOf). The moves
//      go through seat-writes.ts moveLinesHere, each row conditioned on still
//      naming the leaver here, so B's handover of Dana moves B's lines only:
//      Pat's line in A is A's own row and is never touched, and every report
//      here moves, whatever they are elsewhere. Batches 6 to 9 kept a line
//      "another workspace relies on", moved it with the step that ends the
//      account and logged it there (moveReliedReportsAtEnd,
//      otherWorkspaceRows): with one line per workspace there is no such
//      line, so that machinery retired (E6).
//      Each move is logged (reporting_line_changed) IN this transaction, so
//      the record of who went where commits with the moves and can never be
//      lost to a later failure (batch 5), and open reviews follow the new
//      lines (followReportingLine) as soon as it commits, before WORK.
//   2. WORK, without the role lock: the Spaces, Folders and Lists they own
//      (ownerId), so no container is ever left with an owner who cannot sign
//      in, then their OPEN tasks (ownerId and assigneeIds[0], kept in step;
//      done work keeps its owner, history is never rewritten; a meeting's
//      hidden Item is no task and stays). Containers before tasks, the
//      order a Space delete locks them (trash.ts), so the two never deadlock:
//      the containers are locked first (batch 7), Folders, then Spaces, then
//      Lists, each in id order, the order the delete takes them, and only
//      the locked rows are written. FOR NO KEY UPDATE (batch 8), the lock an
//      UPDATE of a row's ownerId takes anyway: it still waits for the
//      delete's FOR UPDATE, so the order holds, and it never blocks the FOR
//      KEY SHARE a foreign-key check takes, so a task created in or moved
//      into one of their Lists, or a List moved into one of their Spaces,
//      goes ahead instead of waiting, or deadlocking, behind WORK.
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
import { reportsHereOf } from "@/lib/access/acting-workspace";
import { lineFactsAround, liveHereAmong, managesNobody } from "@/lib/access/manager-lines";
import { moveLinesHere, removeDottedHere, type LineMove } from "@/lib/access/seat-writes";
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
  /**
   * The goal targets they counted from their Lists (docs/plans/recurring-goals.md
   * C10): moved to the recipient where the recipient may edit the goal and
   * open the List, else left paused with an Inbox row to the goal's owner.
   * Absent when the move could not run (the next handover, or Reconnect,
   * moves them).
   */
  goalSources?: { moved: number; paused: number };
}

/** What LINES moved and recorded before WORK failed. */
export type HandoverLinesDone = Pick<HandoverResult, "reportsReassigned" | "reportsRehomed"> & {
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
  // The moves are logged in the same transaction (batch 5). Every report
  // here moves (E4, E6): the plan reads this workspace's lines only, and
  // moveLinesHere writes the row that holds each report's line here.
  const lines = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, orgId);
    const plan = await reportPlanFor(orgId, id, reassignToId, tx);
    const done = await writeReportMoves(tx, input, plan, reassignToId);
    return { plan, ...done };
  }, LINES_TX);
  const { plan, nameOf } = lines;

  // Open reviews follow the new lines now, whatever WORK does next.
  await followReportingLine(orgId, plan.reportIds, input.actorId ?? reassignToId).catch((e: unknown) => console.error("followReportingLine failed", e));

  const reportsRehomed = lines.rehomed.map(({ id: rid, managerId: up }) => ({ id: rid, name: nameOf(rid), managerId: up, managerName: nameOf(up) }));
  const linesDone: HandoverLinesDone = { reportsReassigned: lines.reports, reportsRehomed, reportsMoved: lines.moved };

  // 2. WORK, without the role lock: containers first, then the open tasks,
  // read and locked here so nothing changed in between is overwritten.
  let work: { tasks: number; containers: number };
  try {
    work = await prisma.$transaction(async (tx) => {
      // The containers, locked in the order a delete takes them (trash.ts:
      // a Space's Folders, then the Space, then its Lists, each in id order),
      // before any is written (batch 7). The updateMany calls locked rows in
      // no order, so WORK could hold List B and wait for List A while a Space
      // delete held A and waited for B, and Postgres ended one of them. Only
      // the rows locked here are written, each still the leaver's.
      // FOR NO KEY UPDATE (batch 8), never FOR UPDATE: ownerId is in no key
      // (no unique index, no foreign key), so the UPDATE below takes this
      // lock anyway and nothing is upgraded. It conflicts with the delete's
      // FOR UPDATE, so the order above still keeps the two from a cycle,
      // but not with the FOR KEY SHARE a foreign-key check takes: FOR UPDATE
      // blocked every task created in their Lists for the whole run, and
      // deadlocked with a task moved into one of their Lists (the mover holds
      // the task, waits for the List; WORK holds the List, waits for the
      // task) and with a List moved into one of their Spaces.
      const folderIds = (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Folder" WHERE "organizationId" = ${orgId} AND "ownerId" = ${id} ORDER BY id FOR NO KEY UPDATE`).map((r) => r.id);
      const spaceIds = (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Space" WHERE "organizationId" = ${orgId} AND "ownerId" = ${id} ORDER BY id FOR NO KEY UPDATE`).map((r) => r.id);
      const listIds = (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Board" WHERE "organizationId" = ${orgId} AND "ownerId" = ${id} ORDER BY id FOR NO KEY UPDATE`).map((r) => r.id);
      const owner = { ownerId: reassignToId };
      const folders = folderIds.length ? await tx.folder.updateMany({ where: { id: { in: folderIds }, ownerId: id }, data: owner }) : { count: 0 };
      const spaces = spaceIds.length ? await tx.space.updateMany({ where: { id: { in: spaceIds }, ownerId: id }, data: owner }) : { count: 0 };
      const lists = listIds.length ? await tx.board.updateMany({ where: { id: { in: listIds }, ownerId: id }, data: owner }) : { count: 0 };
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

  // 3. Their connected goal sources (C10), after the work and on their own:
  // each moves to the recipient after the same checks a connector passes
  // (Can edit on the goal, Can view on the List), and any that fail stay
  // paused, the owner told by Inbox. Best effort: a failure here never
  // undoes the handover; the sources pause once the leaver's account ends.
  let goalSources: { moved: number; paused: number } | undefined;
  try {
    const { handOverGoalSources } = await import("@/lib/goals/goal-source.server");
    goalSources = await handOverGoalSources(orgId, id, reassignToId);
  } catch (e) {
    console.error("handover: moving their goal sources failed; they pause when the account ends", e instanceof Error ? e.message : e);
  }

  return {
    tasksReassigned: work.tasks,
    reportsReassigned: lines.reports,
    containersReassigned: work.containers,
    reportsRehomed,
    ...(goalSources && (goalSources.moved || goalSources.paused) ? { goalSources } : {}),
  };
}

/** Who acted on a move of reporting lines, for its audit rows. */
type MoveActor = { organizationId: string; fromId: string; actorId: string | null; actorType?: string; actorLabel?: string };

/**
 * Write a report plan's moves through seat-writes.ts moveLinesHere (E1, E6,
 * step 4): each report's line HERE, on the row that holds it (the account
 * for someone anchored here, the membership otherwise), each conditioned on
 * still naming the leaver here, so a line of another workspace is never
 * written. Then one audit row per report really moved (moveLinesHere answers
 * exactly who moved), in the same transaction. The caller holds the role
 * lock and planned the moves under it.
 */
async function writeReportMoves(
  tx: Prisma.TransactionClient,
  input: MoveActor,
  plan: { rehome: ReadonlyMap<string | null, readonly string[]>; toRecipient: readonly string[]; reportIds: readonly string[] },
  toId: string | null,
): Promise<{ reports: number; moved: number; nameOf: Names; rehomed: Array<{ id: string; managerId: string | null }> }> {
  const id = input.fromId;
  const moves: LineMove[] = [...plan.rehome].map(([to, ids]) => ({ to, ids }));
  const toRecipient = toId && plan.toRecipient.length > 0 ? moves.push({ to: toId, ids: plan.toRecipient }) - 1 : -1;
  const done = await moveLinesHere(tx, { organizationId: input.organizationId, fromId: id, moves });
  const reports = toRecipient >= 0 ? done[toRecipient].ids.length : 0;
  const rehomed = done.filter((_m, i) => i !== toRecipient).flatMap((m) => m.ids.map((rid) => ({ id: rid, managerId: m.to })));
  const nameOf = await namesFor([id, ...plan.reportIds, ...plan.rehome.keys(), toId], tx);
  const rows = done.flatMap((m) => m.ids.map((rid) => lineMoveRow(input, rid, m.to, nameOf)));
  if (rows.length > 0) await tx.activityLog.createMany({ data: rows });
  return { reports, moved: rows.length, nameOf, rehomed };
}

/** The audit row for one direct report the handover moved: whose line changed, from the leaver to whom. */
function lineMoveRow(input: MoveActor, reportId: string, to: string | null, nameOf: Names) {
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
 * lineFactsAround): the leaver's reports HERE and the walk up from them and
 * from the recipient, at the tier and status each holds here.
 */
async function handoverLinesFor(
  organizationId: string,
  leaverId: string,
  recipientId: string,
  db: Db,
): Promise<{ people: LineMap; managers: ManagerMap; agentIds: Set<string> }> {
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
  // lineFactsAround walked from the recipient too, so every recipient who
  // holds a kept seat here is in `people`, of either kind (anchored here, or
  // here through a membership, since batch 5), at the tier and status held
  // here. One who is absent holds no seat here now, or their account was
  // removed: their seat here ended between the route's check and this lock.
  // They take no reports (the step 4 review L1): the reports go up the
  // leaver's line, as for an Agent or a deactivated recipient. Before, such
  // a recipient was judged by their account's status alone, so one live in
  // another workspace took every report here, under someone with no seat here.
  const recipientIsAgent = people.has(toId) ? agentIds.has(toId) : (await agentIdsIn(organizationId, [toId], db)).has(toId);
  // A deactivated recipient takes no reports either (invariant 13: a
  // deactivated person holds none); the route refuses one as a recipient.
  // Deactivated here is the seat's, or, for someone here through a
  // membership, an account that has ended where it is anchored (D12: it
  // signs in nowhere; manager-lines.ts factsHere reads the same for the walk
  // up, and this read covers a recipient who is also one of the reports).
  const account = await db.user.findUnique({ where: { id: toId }, select: { organizationId: true, status: true, deletedAt: true } });
  const accountEnded = !account || account.deletedAt != null || (account.organizationId !== organizationId && account.status === "INACTIVE");
  const recipientInactive = !people.has(toId) || people.get(toId)!.inactive || accountEnded;
  return { ...planReportHandover({ leaverId: fromId, recipientId: toId, recipientIsAgent, recipientInactive, managers, agentIds, people }), recipientIsAgent };
}

/**
 * What a handover to `toId` would do with the leaver's direct reports, for
 * the transfer dialog to say before it runs (GET /api/users/[id]/handover
 * ?to=): how many move (every report here, E4), whether the recipient is an
 * Agent, and where those who do not go to the recipient land, by name. The
 * same plan runHandover reads, from this workspace's lines only, so the
 * dialog's count, its preview and the summary's reports agree.
 */
export async function previewReportHandover(organizationId: string, fromId: string, toId: string): Promise<{
  reports: number;
  toRecipient: number;
  recipientIsAgent: boolean;
  rehomed: { to: string | null; count: number }[];
}> {
  const plan = await reportPlanFor(organizationId, fromId, toId, prisma);
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
// Only this workspace's lines move (E1, E2, E6, step 4): the solid ones
// whose line here names the Agent (reportsHereOf), through moveLinesHere,
// and this workspace's dotted rows, through removeDottedHere. A line to the
// same person in another workspace, where they may be no Agent at all, is
// that workspace's own row and is never read or touched here.

export interface AgentReportsPlan {
  agent: boolean;
  /** Direct reports that move. */
  solid: number;
  /** Dotted lines taken off. */
  dotted: number;
  /** Where the solid reports go, by name; null is "no manager". */
  rehomed: { to: string | null; toId: string | null; count: number }[];
}

async function agentPlanFor(organizationId: string, agentId: string, db: Db) {
  // The Agent tier they hold in this workspace (manager-lines.ts managesNobody).
  if (!(await managesNobody(agentId, organizationId, db))) return null;
  const { people, managers, agentIds } = await handoverLinesFor(organizationId, agentId, agentId, db);
  const plan = planReportHandover({ leaverId: agentId, recipientId: agentId, recipientIsAgent: true, managers, agentIds, people });
  // This workspace's dotted lines to them (E2), from people who hold a seat
  // here (batch 5: someone here through a membership too): the rows the
  // Members drawer counts (agentsWithStoredReports), never another
  // workspace's, so the preview never says a line was taken off that stays.
  const dotted = await db.userDottedLine.findMany({
    where: { organizationId, managerId: agentId, userId: { not: agentId }, user: { deletedAt: null } },
    select: { userId: true },
  });
  const here = await liveHereAmong(organizationId, dotted.map((d) => d.userId), db);
  return { plan, dottedIds: [...new Set(dotted.map((d) => d.userId))].filter((uid) => here.has(uid)) };
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
    // The lines HERE only (E1, E6), each row conditioned on still naming the Agent here.
    const moves = await moveLinesHere(tx, { organizationId: orgId, fromId: agentId, moves: [...found.plan.rehome].map(([to, ids]) => ({ to, ids })) });
    // This workspace's dotted rows only (E2): another workspace's row of the same pair stays.
    const dottedRemoved = await removeDottedHere(tx, orgId, found.dottedIds.map((userId) => ({ userId, managerId: agentId })));
    return { plan: found.plan, moved: moves.reduce((n, m) => n + m.ids.length, 0), dottedRemoved };
  }, LINES_TX);
  if (!done) return null;
  if ("changed" in done) return { changed: true };
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
 * The direct reports the handover must move before `id`'s seat here can
 * end: everyone whose line HERE names them (reportsHereOf, kept seats: a
 * deactivated report counts, a removed one does not), anchored here or
 * through a membership (E1, E4, step 4). Never a report whose line names
 * them in another workspace: that is that workspace's line, and its own
 * handover moves it. Before, the account lines naming them were counted
 * (another workspace's included) and a report's own line here through a
 * membership was not, so B could end Dana while Pat's B line named her.
 * Batches 8 and 9 left out a report whose line another workspace relied
 * on, which the step ending the account moved; that retired with E6, so
 * every report here is counted and a deactivated or removed person is never
 * left holding one (invariant 13). `db` is the caller's transaction when
 * the count must hold under the role lock (the deactivation's and the
 * removal's gate).
 */
export async function handoverReportCount(organizationId: string, id: string, db: Db = prisma): Promise<number> {
  return (await reportsHereOf(organizationId, [id], db)).filter((r) => r.id !== id).length;
}

/**
 * What a deactivation or a removal would leave behind without a handover:
 * open tasks the person owns, people who report to them, and Spaces, Folders
 * and Lists they own (the same three runHandover moves and the Members
 * transfer dialog counts). PATCH /api/users/[id] refuses { status:
 * "INACTIVE" }, and DELETE refuses a removal (batch 8), while any is
 * non-zero, so no route can orphan a leaver's work (invariant 13): every UI
 * path runs POST /api/users/[id]/handover first, which empties all three.
 * The reports counted are handoverReportCount's: every report here.
 */
export async function pendingHandover(organizationId: string, id: string, db: Db = prisma): Promise<{ openTasks: number; directReports: number; containers: number }> {
  // `db` is the deactivation's or the removal's transaction when the gate is
  // read again under the role lock (batch 9: all three, not the reports alone).
  const [items, reports, spaces, folders, boards] = await Promise.all([
    // A meeting's hidden Item is no task (system-items.ts): never counted, never moved.
    db.item.findMany({ where: { organizationId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS }, select: { status: true } }),
    handoverReportCount(organizationId, id, db),
    db.space.count({ where: { organizationId, ownerId: id } }),
    db.folder.count({ where: { organizationId, ownerId: id } }),
    db.board.count({ where: { organizationId, ownerId: id } }),
  ]);
  return { openTasks: items.filter((it) => isOpenStatus(it.status)).length, directReports: reports, containers: spaces + folders + boards };
}
