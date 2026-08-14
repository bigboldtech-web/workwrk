// Item (task) notification emitters — the ONE door between the Board-Item
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
//   4. `filterNotifyUsers(...)` — the /settings/notifications inbox toggle
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

import { prisma } from "@/lib/prisma";
import { filterNotifyUsers, type NotifyType } from "@/lib/notify-prefs";
import { getBoardStatuses, isDoneStatus } from "@/lib/board-items-shared";

/** Deep link to the standalone task detail page. */
function itemLink(itemId: string): string {
  return `/item/${itemId}`;
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
  /** Stored Notification.type — what /inbox and the bell filter on. */
  type: string;
  recipientIds: (string | null | undefined)[];
  /** Excluded from the fan-out: you never get notified about your own action. */
  actorId: string | null;
  title: string;
  message: string;
  link: string;
}

/**
 * The gate. Returns how many rows were written (0 on any failure — callers
 * treat this as fire-and-forget).
 */
async function emit(args: EmitArgs): Promise<number> {
  try {
    const ids = [...new Set(args.recipientIds.filter((id): id is string => !!id))]
      .filter((id) => id !== args.actorId);
    if (ids.length === 0) return 0;

    // Only real, non-deleted members of this org — ids can arrive from a
    // client payload (ownerId) and a stale/foreign id must never fan out.
    const members = await prisma.user.findMany({
      where: { id: { in: ids }, organizationId: args.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (members.length === 0) return 0;

    // THE preference gate — /settings/notifications inbox toggles.
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
    title: args.reassigned ? "Task reassigned to you" : "Task assigned to you",
    message: `${who} assigned you "${args.item.title}"${due ? ` · due ${due}` : ""}`,
    link: itemLink(args.item.id),
  });
}

/**
 * A task changed status. Recipients = the current owner plus everyone who
 * has commented on the task (the thread is the only durable record of who
 * was pulled in via @mention). Actor excluded, prefs honored.
 *
 * Callers must only invoke this on a REAL transition — passing the same
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
}): Promise<number> {
  if (args.previousStatus === args.status) return 0;
  let participants: string[] = [];
  try {
    const rows = await prisma.itemUpdate.findMany({
      // organizationId leads the (organizationId, entityType, entityId)
      // index — dropping it turns this into a seq scan on a hot table.
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
    // Thread lookup is a bonus — the owner still gets notified.
  }
  const who = await actorName(args.actorId);
  const from = statusLabel(args.board, args.previousStatus);
  const to = statusLabel(args.board, args.status);
  return emit({
    organizationId: args.organizationId,
    prefKey: "status_changes",
    type: "task_status_changed",
    recipientIds: [args.ownerId, ...participants],
    actorId: args.actorId,
    title: args.item.title,
    message: `${who} moved this from ${from} to ${to}`,
    link: itemLink(args.item.id),
  });
}

/**
 * Due-today + overdue sweep over the Item table.
 *
 * NOT WIRED TO A CRON YET — no registered job covers Board Items today
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
  // Open work only — a task already in a DONE/CLOSED status is not "due".
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
      // Fail open — a duplicate beats a missed deadline.
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
      // Nobody "acted" — a date arriving is not an actor's doing, so the
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
