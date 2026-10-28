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
//      A REPORT WHOSE LINE ANOTHER WORKSPACE RELIES ON moves only with the
//      step that ends the leaver's account (batch 8). Status and deletedAt
//      are one column each, so a deactivation or a removal ends the account
//      in every workspace the leaver works in, and a report who also
//      reports to them in another workspace would be left under an account
//      nobody can manage them from (batch 7 moved them for that reason). But
//      batch 7 moved them in the handover, BEFORE the deactivation or
//      removal, which can still be refused (an Owner, the last Owner or
//      Admin, a demoted actor, a busy lock, a dropped connection, a partial
//      handover the admin then cancels, a direct call): the other
//      workspace's live line was rewritten for an account that never ended.
//      So while the leaver's account is live, the handover leaves those
//      reports under them (`reportsAtAccountEnd`, by name), and the step
//      that ends it moves them in its own role-locked transaction, right
//      before it writes status or deletedAt (moveReliedReportsAtEnd: PATCH's
//      deactivation, DELETE, SCIM's deprovisioning), to the same person the
//      handover gave the rest to. That workspace's Audit log gets its own
//      reporting_line_changed row for each, in the same transaction
//      (otherWorkspaceRows), never naming this workspace or anyone who holds
//      no level there (`reportsAlsoElsewhere`). A handover of someone whose
//      account has already ended (deactivated or removed) moves them at
//      once, with that record, as batch 7 did.
//      A leaver who leaves only this workspace (SCIM ending a membership
//      here, `leavesOnlyHere`) keeps them for good: their account stays
//      live elsewhere, so a line another workspace relies on stays, as the
//      Agent move leaves one (`reportsStaying`), and those reports' open
//      reviews here go to the recipient.
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
import { lineKey, lineStandingsElsewhere, linesElsewhere, levelsHeldIn, type LineThere } from "@/lib/access/acting-workspace";
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
  /**
   * Reports left under the leaver (batch 6): only when the leaver leaves this
   * workspace alone (`leavesOnlyHere`) and another workspace, where they
   * still work, relies on that line. Empty on every other handover (batch 7).
   */
  reportsStaying: { id: string; name: string | null }[];
  /**
   * Reports whose line another workspace relies on, left under the leaver
   * because their account is still live (batch 8): the step that ends it
   * moves them (moveReliedReportsAtEnd), with that workspace's record.
   * Empty when the account had already ended, or leavesOnlyHere.
   */
  reportsAtAccountEnd: { id: string; name: string | null }[];
  /**
   * Reports moved whose line another workspace they work in relied on too
   * (batch 7): that workspace's Audit log records the move. Only when the
   * leaver's account had already ended (batch 8).
   */
  reportsAlsoElsewhere: { id: string; name: string | null }[];
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
export type HandoverLinesDone = Pick<HandoverResult, "reportsReassigned" | "reportsRehomed" | "reportsStaying" | "reportsAlsoElsewhere"> & {
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
  /**
   * The leaver leaves this workspace only (SCIM ending a membership here):
   * their account stays live in their other workspaces, so a report whose
   * line to them another workspace relies on stays for good (batch 6's
   * rule). On every other handover such a report stays only while the
   * leaver's account is live, and moves with the step that ends it (batch 8).
   */
  leavesOnlyHere?: boolean;
}): Promise<HandoverResult> {
  const { organizationId: orgId, fromId: id, toId: reassignToId } = input;

  // 1. LINES, under the workspace's role lock (rule 6's race, docs-found
  // fixes batch 3): the report plan is read here, so a role change making
  // the recipient, or the manager above, an Agent waits for this (and then
  // counts the reports it moved) or lands first and is seen by the plan.
  // The moves are logged in the same transaction (batch 5).
  const lines = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, orgId);
    // Whether the leaver's account has ended (batch 8), read under the lock,
    // which every deactivation and removal takes: while it is live, a line
    // another workspace relies on waits for the step that ends it.
    const leaver = await tx.user.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
    const ended = !leaver || leaver.deletedAt != null || leaver.status === "INACTIVE";
    const plan = await reportPlanFor(orgId, id, reassignToId, tx, { keepRelied: input.leavesOnlyHere === true || !ended });
    // An ended account's moved lines that another workspace relied on until
    // then are recorded there; a live one moved none (they are kept).
    const done = await writeReportMoves(tx, input, plan, reassignToId, { recordElsewhere: ended && input.leavesOnlyHere !== true });
    return { plan, ...done };
  }, LINES_TX);
  const { plan, nameOf } = lines;

  // Open reviews follow the new lines now, whatever WORK does next. A report
  // who stays for good (leavesOnlyHere) is listed under someone who works
  // here no more, whom no read here names as a manager, so their open
  // reviews here go to the recipient. A report kept until the account ends
  // still has a live manager, and follows when the line moves.
  await followReportingLine(orgId, [...plan.reportIds, ...(input.leavesOnlyHere ? plan.stays : [])], input.actorId ?? reassignToId).catch((e: unknown) => console.error("followReportingLine failed", e));

  const reportsRehomed = [...plan.rehome.entries()].flatMap(([up, ids]) => ids.map((rid) => ({ id: rid, name: nameOf(rid), managerId: up, managerName: nameOf(up) })));
  const kept = plan.stays.map((rid) => ({ id: rid, name: nameOf(rid) }));
  const reportsStaying = input.leavesOnlyHere ? kept : [];
  const reportsAtAccountEnd = input.leavesOnlyHere ? [] : kept;
  const reportsAlsoElsewhere = lines.alsoElsewhere.map((rid) => ({ id: rid, name: nameOf(rid) }));
  const linesDone: HandoverLinesDone = { reportsReassigned: lines.reports, reportsRehomed, reportsStaying, reportsAlsoElsewhere, reportsMoved: lines.moved };

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
    reportsStaying,
    reportsAtAccountEnd,
    reportsAlsoElsewhere,
    ...(goalSources && (goalSources.moved || goalSources.paused) ? { goalSources } : {}),
  };
}

/** Who acted on a move of reporting lines, for its audit rows. */
type MoveActor = { organizationId: string; fromId: string; actorId: string | null; actorType?: string; actorLabel?: string };

/** How the line moved: in a handover, or with the step that ended the leaver's account (batch 8). */
type MoveHow = "handover" | "deactivated" | "removed";

/**
 * Write a report plan's moves (each conditioned on the report still being
 * listed under the leaver), and their audit rows in the same transaction: one
 * per report moved here, and with `recordElsewhere` one in each other
 * workspace that relied on a moved line (otherWorkspaceRows). The caller
 * holds the role lock. `there` is the caller's own read of those standings,
 * when it has one.
 */
async function writeReportMoves(
  tx: Prisma.TransactionClient,
  input: MoveActor,
  plan: { rehome: ReadonlyMap<string | null, readonly string[]>; toRecipient: readonly string[]; reportIds: readonly string[]; stays: readonly string[] },
  toId: string | null,
  opts: { recordElsewhere: boolean; how?: MoveHow; there?: ReadonlyMap<string, LineThere> },
): Promise<{ reports: number; moved: number; nameOf: Names; alsoElsewhere: string[] }> {
  const id = input.fromId;
  const moves: Array<{ to: string | null; ids: string[]; count: number }> = [];
  for (const [up, ids] of plan.rehome) {
    const r = await tx.user.updateMany({ where: { managerId: id, deletedAt: null, id: { in: [...ids] } }, data: { managerId: up } });
    moves.push({ to: up, ids: [...ids], count: r.count });
  }
  let reports = 0;
  if (toId && plan.toRecipient.length > 0) {
    const r = await tx.user.updateMany({ where: { managerId: id, deletedAt: null, id: { in: [...plan.toRecipient] } }, data: { managerId: toId } });
    moves.push({ to: toId, ids: [...plan.toRecipient], count: r.count });
    reports = r.count;
  }
  // Every write of a reporting line takes this lock, so the plan read under
  // it is what moved. Should a count ever differ, the rows say who moved:
  // the audit names only people really moved.
  for (const m of moves) {
    if (m.count > 0 && m.count !== m.ids.length) {
      m.ids = (await tx.user.findMany({ where: { id: { in: m.ids }, managerId: m.to }, select: { id: true } })).map((u) => u.id);
    }
  }
  const moved = moves.filter((m) => m.count > 0 && m.ids.length > 0);
  // The other workspaces that relied on a moved line until now (batch 7):
  // the leaver's account has ended or is ending, so it is not asked whether
  // they still are live (`leaving`).
  const movedLines = moved.flatMap((m) => m.ids.map((rid) => ({ personId: rid, managerId: id })));
  const there = !opts.recordElsewhere || movedLines.length === 0
    ? new Map<string, LineThere>()
    : opts.there ?? (await lineStandingsElsewhere(input.organizationId, movedLines, tx, { leaving: true }));
  const nameOf = await namesFor([id, ...plan.reportIds, ...plan.stays, ...plan.rehome.keys(), toId], tx);
  if (moved.length > 0) {
    const here = moved.flatMap((m) => m.ids.map((rid) => lineMoveRow(input, rid, m.to, nameOf, opts.how ?? "handover")));
    const elsewhere = await otherWorkspaceRows(id, moved, there, nameOf, tx, opts.how ?? "handover");
    await tx.activityLog.createMany({ data: [...here, ...elsewhere] });
  }
  const alsoElsewhere = movedLines.map((l) => l.personId).filter((rid) => there.get(lineKey({ personId: rid, managerId: id }))?.standing === "relied");
  return { reports, moved: moved.reduce((n, m) => n + m.count, 0), nameOf, alsoElsewhere };
}

/** The audit row for one direct report the handover moved: whose line changed, from the leaver to whom. */
function lineMoveRow(input: MoveActor, reportId: string, to: string | null, nameOf: Names, how: MoveHow = "handover") {
  const who = nameOf(reportId) ?? "Someone";
  const leaver = nameOf(input.fromId) ?? "the person leaving";
  const when = how === "handover" ? "in a handover" : `as ${leaver} was ${how}`;
  return {
    type: "reporting_line_changed",
    actorId: input.actorId,
    organizationId: input.organizationId,
    description: to ? `Moved ${who} from ${leaver} to ${nameOf(to) ?? "a new manager"} ${when}` : `Moved ${who} from ${leaver} to no manager ${when}`,
    targetId: reportId,
    targetType: "user",
    severity: "info",
    oldValue: { managerId: input.fromId },
    newValue: { managerId: to },
    metadata: { handover: true, leaverId: input.fromId, ...(how === "handover" ? {} : { accountEnded: how }) },
    ...(input.actorType ? { actorType: input.actorType } : {}),
    ...(input.actorLabel ? { actorLabel: input.actorLabel } : {}),
  };
}

/**
 * The rows for the other workspaces that relied on a moved line (batch 7): one
 * reporting_line_changed row in each, in that workspace's Audit log, so it has
 * a record of why the report's manager changed there too. Written by no
 * person of that workspace (actorType "system", "Another workspace"), and it
 * never names this workspace. The new manager is named only where they hold
 * a level in that workspace; anyone else is "someone in another workspace".
 * A move made with the step that ended the leaver's account (batch 8) says
 * so: "as Leo Leaver's account was ended in another workspace they work in".
 */
async function otherWorkspaceRows(
  leaverId: string,
  moved: ReadonlyArray<{ to: string | null; ids: readonly string[] }>,
  there: ReadonlyMap<string, LineThere>,
  nameOf: Names,
  db: Db,
  how: MoveHow = "handover",
) {
  const orgs = [...new Set([...there.values()].flatMap((t) => t.reliedIn))];
  if (orgs.length === 0) return [];
  const destinations = [...new Set(moved.map((m) => m.to).filter((x): x is string => !!x))];
  const heldThere = new Map(await Promise.all(orgs.map(async (org) => [org, await levelsHeldIn(org, destinations, db)] as const)));
  const who = (rid: string) => nameOf(rid) ?? "Someone";
  const leaver = nameOf(leaverId) ?? "their manager";
  const inOther = how === "handover" ? "in a handover in another workspace they work in" : `as ${leaver}'s account was ended in another workspace they work in`;
  const there_ = how === "handover" ? "in a handover there" : `as ${leaver}'s account was ended there`;
  return moved.flatMap((m) =>
    m.ids.flatMap((rid) =>
      (there.get(lineKey({ personId: rid, managerId: leaverId }))?.reliedIn ?? []).map((org) => {
        const named = m.to && heldThere.get(org)?.has(m.to) ? nameOf(m.to) : null;
        const description = !m.to
          ? `Moved ${who(rid)} from ${leaver} to no manager, ${inOther}`
          : named
            ? `Moved ${who(rid)} from ${leaver} to ${named}, ${inOther}`
            : `Moved ${who(rid)} from ${leaver} to someone in another workspace, ${there_}`;
        return {
          type: "reporting_line_changed",
          actorId: null,
          actorType: "system",
          actorLabel: "Another workspace",
          organizationId: org,
          description,
          targetId: rid,
          targetType: "user",
          severity: "info",
          oldValue: { managerId: leaverId },
          newValue: { managerId: m.to },
          metadata: { handover: true, leaverId, fromAnotherWorkspace: true, ...(how === "handover" ? {} : { accountEnded: how }) },
        };
      }),
    ),
  );
}

/**
 * The line facts the report plan reads, and no more (manager-lines.ts
 * lineFactsAround). With `keepRelied`, also the reports whose line to
 * `leaverId` another workspace relies on (`stays`, batch 6), which this
 * step leaves: only while `leaverId` stays a live manager there (an Agent
 * here, a leaver who leaves only this workspace, or a leaver whose account
 * the next step ends, batch 8). A handover of an account that has already
 * ended keeps nobody (batch 7).
 */
async function handoverLinesFor(
  organizationId: string,
  leaverId: string,
  recipientId: string,
  db: Db,
  keepRelied: boolean,
): Promise<{ people: LineMap; managers: ManagerMap; agentIds: Set<string>; stays: Set<string> }> {
  const people = await lineFactsAround(organizationId, leaverId, [recipientId], db);
  const managers: ManagerMap = new Map([...people].map(([uid, p]) => [uid, p.managerId]));
  const agentIds = new Set([...people].filter(([, p]) => p.agent).map(([uid]) => uid));
  const reports = [...people].filter(([uid, p]) => p.managerId === leaverId && uid !== leaverId).map(([uid]) => uid);
  const stays = keepRelied ? await reportsStayingWith(organizationId, leaverId, reports, db) : new Set<string>();
  return { people, managers, agentIds, stays };
}

/**
 * Of these direct reports of `managerId`, the ones whose line another
 * workspace relies on: they also work there, and `managerId` holds a live
 * level there that is not the Agent tier (acting-workspace.ts
 * linesElsewhere). The line is that workspace's too, so the Agent move, and
 * a handover of someone who leaves only this workspace, leave it.
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
async function reportPlanFor(organizationId: string, fromId: string, toId: string, db: Db = prisma, opts: { keepRelied?: boolean } = {}) {
  const { people, managers, agentIds, stays } = await handoverLinesFor(organizationId, fromId, toId, db, opts.keepRelied === true);
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
 * ?to=): how many move (every one, batch 7), whether the recipient is an
 * Agent, where those who do not go to the recipient land, by name, and who
 * of them also reports to the leaver in another workspace (`alsoElsewhere`,
 * by name): the move reaches that workspace too, and its Audit log records
 * it. Those move when the deactivation or removal lands (batch 8:
 * moveReliedReportsAtEnd, to the same person), the rest with the handover,
 * unless the leaver's account has already ended (`accountEnded`, batch 9:
 * deactivated or removed), when the handover moves them at once (runHandover
 * reads the same two columns), so the dialog says so instead of "only once
 * they are removed".
 */
export async function previewReportHandover(organizationId: string, fromId: string, toId: string): Promise<{
  reports: number;
  toRecipient: number;
  recipientIsAgent: boolean;
  rehomed: { to: string | null; count: number }[];
  alsoElsewhere: { id: string; name: string | null }[];
  accountEnded: boolean;
}> {
  const leaver = await prisma.user.findUnique({ where: { id: fromId }, select: { status: true, deletedAt: true } });
  const accountEnded = !leaver || leaver.deletedAt != null || leaver.status === "INACTIVE";
  const plan = await reportPlanFor(organizationId, fromId, toId);
  const there = plan.reportIds.length
    ? await lineStandingsElsewhere(organizationId, plan.reportIds.map((personId) => ({ personId, managerId: fromId })), prisma, { leaving: true })
    : new Map<string, LineThere>();
  const alsoElsewhere = plan.reportIds.filter((rid) => there.get(lineKey({ personId: rid, managerId: fromId }))?.standing === "relied");
  const nameOf = await namesFor([...plan.rehome.keys(), ...alsoElsewhere]);
  return {
    reports: plan.reportIds.length,
    toRecipient: plan.toRecipient.length,
    recipientIsAgent: plan.recipientIsAgent,
    rehomed: [...plan.rehome.entries()].map(([up, rs]) => ({ to: nameOf(up), count: rs.length })),
    alsoElsewhere: alsoElsewhere.map((rid) => ({ id: rid, name: nameOf(rid) })),
    accountEnded,
  };
}

// ── The step that ends an account (batch 8) ──────────────────────────

/** What moveReliedReportsAtEnd moved. */
export interface AccountEndLines {
  /** Every report moved, to the recipient or up the line. */
  reportsMoved: number;
  /** Moved to the recipient. */
  reportsReassigned: number;
  /** Moved up the leaver's line, or to no manager, by name. */
  reportsRehomed: HandoverResult["reportsRehomed"];
  /** Every one of them: their line to the leaver another workspace relied on, whose Audit log records the move. */
  reportsAlsoElsewhere: { id: string; name: string | null }[];
  /** Who moved, for followReportingLine once the step commits (followAccountEndLines). */
  reportIds: string[];
}

const NOTHING_AT_END: AccountEndLines = { reportsMoved: 0, reportsReassigned: 0, reportsRehomed: [], reportsAlsoElsewhere: [], reportIds: [] };

/**
 * The reports whose line to the leaver another workspace relies on, moved
 * by the step that ends the leaver's account (batch 8), inside ITS
 * transaction, which already holds the role lock: PATCH /api/users/[id]'s
 * deactivation and DELETE's removal, right before they write status or
 * deletedAt, and SCIM's deprovisioning, right before its deactivation. The
 * handover leaves these while the account is live, because that step can
 * still be refused; here nothing moves unless the account ends with it, and
 * a refusal later in the same transaction rolls the moves back with it.
 *
 * They go where the handover sent the rest: to `recipientId` (the person the
 * dialog picked), unless that would make a loop or the recipient is an
 * Agent or deactivated, else up the leaver's line to the first person who
 * can manage them now, else to no manager (planReportHandover). With nobody
 * named, or someone who no longer works here, up the line. Each move is
 * logged here and in every workspace that relied on it, in the same
 * transaction (otherWorkspaceRows), as the handover's own moves are. The
 * reports no other workspace relies on are the handover's to move (PATCH's
 * and DELETE's gate refuses while any is left).
 *
 * EVERY REPORT STILL LISTED UNDER THE LEAVER MOVES HERE (docs-found fixes
 * batch 9). The gate and this step each read "relied" (lineStandingsElsewhere)
 * on their own, under this workspace's role lock only, so another workspace
 * could end the report's or the leaver's membership there in between: Ida was
 * relied on at the gate, so not counted, and not relied on here, so batch 8
 * left her under an account that then ended (invariant 13). The gate has
 * already refused, under the same lock, while any report it did not see as
 * relied was left, so whoever is still listed here is moved; only the lines
 * relied on now get the other workspace's record (`reportsAlsoElsewhere`).
 * SCIM's deactivation takes no gate before it: there this moves every report
 * with the deactivation, and the handover after it finds none left.
 */
export async function moveReliedReportsAtEnd(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    leaverId: string;
    recipientId: string | null;
    actorId: string | null;
    actorType?: string;
    actorLabel?: string;
    ends: "deactivated" | "removed";
  },
): Promise<AccountEndLines> {
  const { organizationId: orgId, leaverId } = input;
  const recipient = input.recipientId && input.recipientId !== leaverId ? input.recipientId : null;
  const people = await lineFactsAround(orgId, leaverId, recipient ? [recipient] : [], tx);
  const reports = [...people].filter(([uid, p]) => p.managerId === leaverId && uid !== leaverId).map(([uid]) => uid);
  if (reports.length === 0) return NOTHING_AT_END;
  // `leaving`: the leaver may be deactivated already (a removal after a
  // deactivation), and the line still counted there until now. Read once,
  // here, for the records only: it never decides who moves (batch 9).
  const there = await lineStandingsElsewhere(orgId, reports.map((personId) => ({ personId, managerId: leaverId })), tx, { leaving: true });
  const managers: ManagerMap = new Map([...people].map(([uid, p]) => [uid, p.managerId]));
  const agentIds = new Set([...people].filter(([, p]) => p.agent).map(([uid]) => uid));
  // lineFactsAround walked from the recipient too: present only when they
  // are not removed and hold a level here, at the tier held here.
  const to = recipient && people.has(recipient) ? recipient : null;
  const plan = planReportHandover({
    leaverId,
    // Nobody to take them: the routing an Agent recipient gets, up the line.
    recipientId: to ?? leaverId,
    recipientIsAgent: to ? people.get(to)!.agent : true,
    recipientInactive: to ? people.get(to)!.inactive : false,
    managers,
    agentIds,
    people,
    // Nobody stays under an account that ends (batch 9).
    stays: new Set<string>(),
  });
  const done = await writeReportMoves(
    tx,
    { organizationId: orgId, fromId: leaverId, actorId: input.actorId, actorType: input.actorType, actorLabel: input.actorLabel },
    plan,
    to,
    { recordElsewhere: true, how: input.ends, there },
  );
  const reportsRehomed = [...plan.rehome.entries()].flatMap(([up, ids]) => ids.map((rid) => ({ id: rid, name: done.nameOf(rid), managerId: up, managerName: done.nameOf(up) })));
  return {
    reportsMoved: done.moved,
    reportsReassigned: done.reports,
    reportsRehomed,
    reportsAlsoElsewhere: done.alsoElsewhere.map((rid) => ({ id: rid, name: done.nameOf(rid) })),
    reportIds: plan.reportIds,
  };
}

/** Open reviews follow the lines the step that ended an account moved, once it commits; never failing it. */
export async function followAccountEndLines(organizationId: string, done: AccountEndLines, actorId: string): Promise<void> {
  if (done.reportIds.length === 0) return;
  await followReportingLine(organizationId, done.reportIds, actorId).catch((e: unknown) => console.error("followReportingLine failed", e));
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
  // The Agent stays a live manager in a workspace where they are no Agent, so
  // a line that workspace relies on stays (batch 6; kept in batch 7).
  const { people, managers, agentIds, stays } = await handoverLinesFor(organizationId, agentId, agentId, db, true);
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
 * The direct reports the handover must move before `id`'s account can end:
 * everyone stored under them who holds a level here (batch 5), anchored here
 * or through a membership, except a report whose line another workspace
 * relies on (batch 8). The step that ends the account moves those itself
 * (moveReliedReportsAtEnd), so they never block it; batch 7 counted them,
 * which was right only while the handover moved them, before the step that
 * could still be refused. Every other report is counted, so a deactivated or
 * removed person is never left holding one (invariant 13). `db` is the
 * caller's transaction when the count must hold under the role lock (the
 * deactivation's and the removal's gate).
 */
export async function handoverReportCount(organizationId: string, id: string, db: Db = prisma): Promise<number> {
  const rows = await db.user.findMany({ where: { managerId: id, deletedAt: null }, select: { id: true } });
  const here = [...(await liveHereAmong(organizationId, rows.map((r) => r.id), db))].filter((rid) => rid !== id);
  if (here.length === 0) return 0;
  // `leaving`, as the step that ends the account reads it: a deactivated
  // leaver's line still counts there until it moves.
  const there = await lineStandingsElsewhere(organizationId, here.map((personId) => ({ personId, managerId: id })), db, { leaving: true });
  return here.filter((rid) => there.get(lineKey({ personId: rid, managerId: id }))?.standing !== "relied").length;
}

/**
 * What a deactivation or a removal would leave behind without a handover:
 * open tasks the person owns, people who report to them, and Spaces, Folders
 * and Lists they own (the same three runHandover moves and the Members
 * transfer dialog counts). PATCH /api/users/[id] refuses { status:
 * "INACTIVE" }, and DELETE refuses a removal (batch 8), while any is
 * non-zero, so no route can orphan a leaver's work (invariant 13): every UI
 * path runs POST /api/users/[id]/handover first, which empties all three.
 * The reports counted are handoverReportCount's: a report whose line another
 * workspace relies on moves with the deactivation or removal itself (batch
 * 8), so it never holds one up.
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
