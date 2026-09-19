// Item (task) notification emitters: the ONE door between the Board-Item
// pipeline and the Notification table.
//
// Why a single door: before this file the real task system emitted ZERO
// Notification rows (assign, status change and due dates were all silent),
// while the handful of producers that did exist each re-implemented the
// preference check by hand. Every function here funnels through `emit()`,
// which applies, in order:
//
//   1. de-dupe the recipient list
//   2. drop the ACTOR (nobody is notified about their own click)
//   3. keep only real, live members of the item's organization
//   4. `filterNotifyUsers(...)`: the /settings/notifications inbox toggle
//   5. one `createMany`
//
// A future producer that wants to notify about an item calls one of these
// exports; it cannot reach the table without passing the prefs gate.
//
// Everything here is BEST EFFORT: emitters never throw and never block the
// write they follow. A notification failure must not fail a task save.
//
// Notification.type values written here (consumed by /inbox + the bell):
//   task_assigned · task_status_changed · task_due_today · task_overdue
//   task_comment  (Phase 2)

import { prisma } from "@/lib/prisma";
import { filterNotifyUsers, type NotifyType } from "@/lib/notify-prefs";
import { getBoardStatuses, isDoneStatus } from "@/lib/board-items-shared";
import { notifyTargets, readWatchers } from "@/lib/item-watchers";

/**
 * Deep link to the standalone task detail page.
 *
 * `updateId` anchors on one comment (`/item/<id>?comment=<updateId>`), which is
 * what `GET /api/items/[id]/updates?around=` exists to serve: without it every
 * Inbox comment row landed at the top of a thread that can be hundreds long.
 * spec-task-detail.md lines 267 and 297 specify exactly this shape.
 */
function itemLink(itemId: string, updateId?: string | null): string {
  return updateId ? `/item/${itemId}?comment=${updateId}` : `/item/${itemId}`;
}

/** "IN_PROGRESS" → "In progress" when the board defines no label for it. */
function humanizeStatus(value: string | null | undefined): string {
  if (!value) return "No status";
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Board status label when the board declares one, else a humanized key. */
function statusLabel(board: { statuses?: unknown } | null | undefined, value: string | null | undefined): string {
  if (!value) return "No status";
  const opt = getBoardStatuses(board).find((s) => s.value === value);
  return opt?.label ?? humanizeStatus(value);
}

function formatDue(due: Date | string | null | undefined): string | null {
  if (!due) return null;
  const d = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface EmitArgs {
  organizationId: string;
  /** Preference key the recipient's /settings/notifications toggle controls. */
  prefKey: NotifyType;
  /** Stored Notification.type: what /inbox and the bell filter on. */
  type: string;
  recipientIds: (string | null | undefined)[];
  /** Excluded from the fan-out: you never get notified about your own action. */
  actorId: string | null;
  title: string;
  message: string;
  link: string;
}

/**
 * The gate. Returns how many rows were written (0 on any failure, callers
 * treat this as fire-and-forget).
 */
async function emit(args: EmitArgs): Promise<number> {
  try {
    const ids = [...new Set(args.recipientIds.filter((id): id is string => !!id))]
      .filter((id) => id !== args.actorId);
    if (ids.length === 0) return 0;

    // Only real, non-deleted members of this org, ids can arrive from a
    // client payload (ownerId) and a stale/foreign id must never fan out.
    const members = await prisma.user.findMany({
      where: { id: { in: ids }, organizationId: args.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (members.length === 0) return 0;

    // THE preference gate: /settings/notifications inbox toggles.
    const wanted = await filterNotifyUsers(members.map((m) => m.id), args.prefKey);
    if (wanted.size === 0) return 0;

    const created = await prisma.notification.createMany({
      data: [...wanted].map((userId) => ({
        userId,
        type: args.type,
        title: args.title,
        message: args.message,
        link: args.link,
      })),
    });
    return created.count;
  } catch (err) {
    console.error("[notify-item] emit failed:", err);
    return 0;
  }
}

/** Display name for the actor, or "Someone" when unknown. */
async function actorName(actorId: string | null): Promise<string> {
  if (!actorId) return "Someone";
  try {
    const u = await prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true, lastName: true },
    });
    const name = `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim();
    return name || "Someone";
  } catch {
    return "Someone";
  }
}

// ── Producers ──────────────────────────────────────────────────────

export interface ItemNotifyTarget {
  id: string;
  title: string;
  dueAt?: Date | string | null;
}

/**
 * A task landed on someone. Fired by POST /api/boards/[id]/items (created
 * with an owner) and by PATCH /api/items/[id] (ownerId changed).
 *
 * No-op when the owner is the actor (assigning yourself work is not news)
 * or when ownerId is null (unassignment notifies nobody).
 */
export async function notifyItemAssigned(args: {
  organizationId: string;
  item: ItemNotifyTarget;
  ownerId: string | null;
  actorId: string | null;
  /** Set on reassignment so the copy reads "reassigned" instead of "assigned". */
  reassigned?: boolean;
}): Promise<number> {
  if (!args.ownerId || args.ownerId === args.actorId) return 0;
  const who = await actorName(args.actorId);
  const due = formatDue(args.item.dueAt);
  return emit({
    organizationId: args.organizationId,
    prefKey: "task_assigned",
    type: "task_assigned",
    recipientIds: [args.ownerId],
    actorId: args.actorId,
    // THE TITLE IS THE SUBJECT, not the kind. Every other writer here puts
    // the task's name on line 1 (`title: args.item.title`), and the Inbox row
    // and the Home widget both print line 1 as the row's identity. Writing the
    // kind here gave a list of six consecutive rows all reading "Task assigned
    // to you", indistinguishable from each other, while the rows between them
    // were named after their task. The kind already has a place: the glyph and
    // the kind label in the pane header. The "reassigned" wording moves into
    // the message, where the sentence is.
    title: args.item.title,
    message: `${who} ${args.reassigned ? "reassigned you" : "assigned you"} this task${due ? ` · due ${due}` : ""}`,
    link: itemLink(args.item.id),
  });
}

/**
 * A task changed status. Recipients = the current owner plus everyone who
 * has commented on the task (the thread is the only durable record of who
 * was pulled in via @mention). Actor excluded, prefs honored.
 *
 * Callers must only invoke this on a REAL transition, passing the same
 * value twice returns 0 rather than writing a duplicate row.
 */
export async function notifyItemStatusChanged(args: {
  organizationId: string;
  item: ItemNotifyTarget;
  board?: { statuses?: unknown } | null;
  previousStatus: string | null;
  status: string | null;
  ownerId: string | null;
  actorId: string | null;
  /**
   * Phase 2: the task's `Item.metadata`, so watchers are told too and anyone
   * in `unwatchers` is not. Absent = the pre-Phase-2 behaviour (owner plus
   * everyone who has commented), which is what makes this widening safe to
   * land before every caller passes it.
   */
  metadata?: unknown;
}): Promise<number> {
  if (args.previousStatus === args.status) return 0;
  const watcherState = readWatchers(args.metadata);
  const watchers = notifyTargets(watcherState, args.actorId);
  let participants: string[] = [];
  try {
    const rows = await prisma.itemUpdate.findMany({
      // organizationId leads the (organizationId, entityType, entityId)
      // index: dropping it turns this into a seq scan on a hot table.
      where: {
        organizationId: args.organizationId,
        entityType: "BOARD_ITEM",
        entityId: args.item.id,
        archivedAt: null,
      },
      select: { authorId: true },
      distinct: ["authorId"],
      take: 50,
    });
    participants = rows.map((r) => r.authorId).filter((id): id is string => !!id);
  } catch {
    // Thread lookup is a bonus: the owner still gets notified.
  }
  const who = await actorName(args.actorId);
  const from = statusLabel(args.board, args.previousStatus);
  const to = statusLabel(args.board, args.status);
  // Anyone who explicitly stopped watching is dropped last, so neither the
  // owner row nor the commenter list can quietly put them back on the thread.
  const recipients = [args.ownerId, ...participants, ...watchers].filter(
    (id): id is string => !!id && !watcherState.unwatchers.includes(id),
  );
  return emit({
    organizationId: args.organizationId,
    prefKey: "status_changes",
    type: "task_status_changed",
    recipientIds: recipients,
    actorId: args.actorId,
    title: args.item.title,
    message: `${who} moved this from ${from} to ${to}`,
    link: itemLink(args.item.id),
  });
}

/**
 * Someone commented on a task.
 *
 * Recipients = the task's WATCHERS plus its assignees, minus the actor, minus
 * anyone who explicitly unwatched, honouring the recipient's "Comments" inbox
 * toggle. Mentions are a separate message with a separate toggle and are
 * emitted by the updates route, so a person who is both mentioned and watching
 * gets the mention row (more specific) and this one; the Inbox groups them by
 * task, which is the behaviour the spec's Inbox block describes.
 *
 * Best effort, like everything else here: it never throws and never blocks the
 * comment that has already been written.
 */
export async function notifyItemCommented(args: {
  organizationId: string;
  item: ItemNotifyTarget;
  /** The task's Item.metadata, read for `watchers` / `unwatchers`. */
  metadata?: unknown;
  /** Assignee ids (ownerId first); they hear about their own work. */
  assigneeIds?: string[];
  actorId: string | null;
  /** The comment body, trimmed for the Inbox preview line. */
  preview?: string | null;
  /** Already told about this comment as a mention; skipped here. */
  excludeUserIds?: string[];
  /** The ItemUpdate id, so the row deep-links straight to the comment. */
  updateId?: string | null;
}): Promise<number> {
  const state = readWatchers(args.metadata);
  const exclude = new Set(args.excludeUserIds ?? []);
  const recipients = [...notifyTargets(state, args.actorId), ...(args.assigneeIds ?? [])].filter(
    (id) => !!id && !state.unwatchers.includes(id) && !exclude.has(id),
  );
  if (recipients.length === 0) return 0;
  const who = await actorName(args.actorId);
  const snippet = (args.preview ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  return emit({
    organizationId: args.organizationId,
    prefKey: "comments",
    type: "task_comment",
    recipientIds: recipients,
    actorId: args.actorId,
    title: args.item.title,
    message: snippet ? `${who} commented: ${snippet}` : `${who} commented on this task`,
    link: itemLink(args.item.id, args.updateId),
  });
}

/**
 * Due-today + overdue sweep over the Item table.
 *
 * NOT WIRED TO A CRON YET: no registered job covers Board Items today
 * (`/api/email/send-reminders` §3b sweeps the LEGACY `Task` table only, and
 * that route is itself absent from scripts/CRON-SETUP.md). This is the
 * ready-to-call producer: one daily call is all it needs. See the handoff
 * note in the Wave-1 report.
 *
 * Idempotent per calendar day: before writing it reads back today's rows of
 * the same type + link and skips anyone already told, so running the sweep
 * hourly (or twice after a retry) cannot spam a user.
 */
export async function notifyItemsDueToday(opts: {
  now?: Date;
  /** Limit the sweep to one org (tests / single-tenant crons). */
  organizationId?: string;
  /** Safety cap on rows scanned per bucket. */
  take?: number;
} = {}): Promise<{ dueToday: number; overdue: number; scanned: number }> {
  const now = opts.now ?? new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const take = opts.take ?? 500;

  const rows = await prisma.item.findMany({
    where: {
      archivedAt: null,
      ownerId: { not: null },
      dueAt: { not: null, lte: endOfDay },
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
    },
    select: {
      id: true, title: true, status: true, ownerId: true, dueAt: true, organizationId: true,
      board: { select: { statuses: true } },
    },
    orderBy: { dueAt: "desc" },
    take,
  });
  // Open work only: a task already in a DONE/CLOSED status is not "due".
  const open = rows.filter((r) => !isDoneStatus(getBoardStatuses(r.board), r.status));

  // Already-notified check, scoped to today so tomorrow's sweep re-notifies.
  // Keyed on userId (the leading column of Notification's index) rather than
  // on `link`, which is unindexed and would seq-scan the table.
  const ownerIds = [...new Set(open.map((r) => r.ownerId!).filter(Boolean))];
  const seen = new Set<string>();
  if (ownerIds.length > 0) {
    try {
      const existing = await prisma.notification.findMany({
        where: {
          userId: { in: ownerIds },
          createdAt: { gte: startOfDay },
          type: { in: ["task_due_today", "task_overdue"] },
        },
        select: { userId: true, link: true, type: true },
      });
      for (const e of existing) seen.add(`${e.userId}|${e.link}|${e.type}`);
    } catch {
      // Fail open: a duplicate beats a missed deadline.
    }
  }

  let dueToday = 0;
  let overdue = 0;
  for (const r of open) {
    const isOverdue = r.dueAt! < startOfDay;
    const type = isOverdue ? "task_overdue" : "task_due_today";
    if (seen.has(`${r.ownerId}|${itemLink(r.id)}|${type}`)) continue;
    const days = isOverdue
      ? Math.max(1, Math.floor((startOfDay.getTime() - r.dueAt!.getTime()) / 86_400_000))
      : 0;
    const wrote = await emit({
      organizationId: r.organizationId,
      prefKey: "due_reminders",
      type,
      recipientIds: [r.ownerId],
      // Nobody "acted": a date arriving is not an actor's doing, so the
      // owner is notified even about a task they assigned themselves.
      actorId: null,
      title: isOverdue ? "Task overdue" : "Task due today",
      message: isOverdue
        ? `"${r.title}" was due ${days} day${days === 1 ? "" : "s"} ago`
        : `"${r.title}" is due today`,
      link: itemLink(r.id),
    });
    if (wrote > 0) {
      if (isOverdue) overdue += wrote;
      else dueToday += wrote;
    }
  }
  return { dueToday, overdue, scanned: open.length };
}
