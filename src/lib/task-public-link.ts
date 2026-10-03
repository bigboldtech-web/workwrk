// A task's public, view-only link (access-model toggle 10, "Public links").
//
// The link is /share/task/<itemId>.<secret>. The secret lives in its own
// table ("ItemPublicLink", prisma/sql/2026-10-04-item-public-link.sql), never
// in the task's metadata, which reaches every reader in every row payload.
//
// WHO. Anyone who may share the task turns it on and off and sees the
// address: an org Owner or Admin, or someone who may add to its home List
// (the add rule a share into another List already uses, linkedRowAccess
// canShare). Turning it on also needs the workspace to allow task links
// (Public links set to View only, src/lib/public-links.ts
// orgPublicLinksTurnedOn), a live task in a live place, and a home that is
// not a Personal List (its owner's alone, as the menu says). Turning it off
// needs only the right to share, so a link can always be withdrawn. A reader
// who reaches the task only through a List it is linked into may not: the
// home is not theirs.
//
// SETTINGS (founder decision 4, docs/plans/competitor-gap-2026-09.md:
// "view-only, optional expiry, and a toggle to hide assignees and comments"):
// an expiry of 7, 30 or 90 days or none, and "showPeople", off unless the
// sharer turns it on, which adds the assignees' first names and the comments.
//
// WHAT THE PAGE SHOWS, and never more (src/app/api/public/tasks/[token]):
// the task's title, status, priority, dates, description, checklist, its
// subtasks' titles and statuses, and the workspace's name and logo; with
// showPeople also the assignees' first names and the comments. Never
// attachments, activity, custom fields, connected tasks, the List or Space it
// is in, ids, or any email.
//
// OFF deletes the row, so turning it on again mints a NEW secret and an old
// copy of the link never comes back. The workspace switch off, an expiry
// passed, or the task, its List, a Folder above it or its Space in Trash
// makes every link answer the one "invalid or turned off" sentence without
// deleting anything.
//
// Every change writes the task's activity row and the workspace's audit row
// (access.public_link.*) in the same transaction as the change itself, so a
// link is never live without its record.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { newPublicSecret } from "@/lib/doc-sharing";
import { BOARD_ITEM_ENTITY_TYPE } from "@/lib/item-thread";
import { canContributeFor, viewerIsOrgAdmin, type LinkViewer } from "@/lib/list-links-server";

export const TASK_SHARE_PATH = "/share/task/";

/** The expiry choices the dialog offers, in days. */
export const TASK_LINK_EXPIRY_DAYS = [7, 30, 90] as const;

export interface TaskLinkRow {
  secret: string;
  createdAt: Date;
  expiresAt: Date | null;
  showPeople: boolean;
}

export interface TaskLinkSettings {
  expiresAt: Date | null;
  showPeople: boolean;
}

/** The token in the address: the task id (a cuid, never a dot) and the secret. */
export function taskLinkToken(itemId: string, secret: string): string {
  return `${itemId}.${secret}`;
}

/** The two halves of a token, split on the FIRST dot, or null for anything else. */
export function parseTaskLinkToken(token: string): { itemId: string; secret: string } | null {
  const i = token.indexOf(".");
  if (i <= 0 || i >= token.length - 1) return null;
  const itemId = token.slice(0, i);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) return null;
  return { itemId, secret: token.slice(i + 1) };
}

/**
 * An expiry choice as a date: null for "never", undefined when the value is
 * not one the dialog offers (the route answers 400).
 */
export function expiryFromDays(days: unknown, now: Date = new Date()): Date | null | undefined {
  if (days === null) return null;
  if (typeof days !== "number" || !(TASK_LINK_EXPIRY_DAYS as readonly number[]).includes(days)) return undefined;
  return new Date(now.getTime() + days * 86_400_000);
}

/** Has this link's expiry passed? */
export function taskLinkExpired(link: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  return !!link.expiresAt && link.expiresAt.getTime() <= now.getTime();
}

/** A missing table or column (the SQL file not applied yet) reads as "no link". */
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "P2022" || (err instanceof Error && /ItemPublicLink/.test(err.message) && /does not exist/i.test(err.message));
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

const LINK_SELECT = { secret: true, createdAt: true, expiresAt: true, showPeople: true } as const;

export async function readTaskLink(itemId: string): Promise<TaskLinkRow | null> {
  try {
    return await prisma.itemPublicLink.findUnique({ where: { itemId }, select: LINK_SELECT });
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

type Tx = Prisma.TransactionClient;

type LinkEvent = "on" | "off" | "changed";

const ITEM_ACTION: Record<LinkEvent, string> = { on: "PUBLIC_LINK_ON", off: "PUBLIC_LINK_OFF", changed: "PUBLIC_LINK_CHANGED" };
const AUDIT_TYPE: Record<LinkEvent, string> = { on: "access.public_link.on", off: "access.public_link.off", changed: "access.public_link.changed" };
const AUDIT_SENTENCE: Record<LinkEvent, string> = {
  on: "Turned on the public link of a task",
  off: "Turned off the public link of a task",
  changed: "Changed the public link of a task",
};

/**
 * The task's own activity row and the workspace's audit row, written in the
 * change's transaction. The audit description names only the noun (the feeds
 * that print it are read by others); the id and the settings ride in
 * metadata, never the secret or the address.
 */
async function recordLink(tx: Tx, event: LinkEvent, a: { itemId: string; organizationId: string; userId: string; settings: TaskLinkSettings | null }): Promise<void> {
  const settings = a.settings
    ? { expiresAt: a.settings.expiresAt ? a.settings.expiresAt.toISOString() : null, showPeople: a.settings.showPeople }
    : {};
  await tx.itemActivity.create({
    data: { organizationId: a.organizationId, entityType: BOARD_ITEM_ENTITY_TYPE, entityId: a.itemId, actorId: a.userId, action: ITEM_ACTION[event], meta: settings },
  });
  await tx.activityLog.create({
    data: {
      type: AUDIT_TYPE[event],
      actorId: a.userId,
      organizationId: a.organizationId,
      targetType: "item",
      targetId: a.itemId,
      description: AUDIT_SENTENCE[event],
      metadata: { nodeKind: "task", nodeId: a.itemId, source: "task-public-link", ...settings } as Prisma.InputJsonValue,
      severity: "warning",
    },
  });
}

/**
 * On: the existing link when it is already on (its settings untouched), else
 * a new one with these settings, its records in the same transaction.
 */
export async function turnOnTaskLink(
  itemId: string,
  organizationId: string,
  userId: string,
  settings: TaskLinkSettings,
): Promise<TaskLinkRow & { created: boolean }> {
  const existing = await readTaskLink(itemId);
  if (existing) return { ...existing, created: false };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const made = await tx.itemPublicLink.create({
        data: { itemId, organizationId, secret: newPublicSecret(), createdById: userId, expiresAt: settings.expiresAt, showPeople: settings.showPeople },
        select: LINK_SELECT,
      });
      await recordLink(tx, "on", { itemId, organizationId, userId, settings });
      return made;
    });
    return { ...row, created: true };
  } catch (err) {
    // Two people turned it on at once: the first one's link stands.
    if (isUniqueViolation(err)) {
      const again = await readTaskLink(itemId);
      if (again) return { ...again, created: false };
    }
    throw err;
  }
}

/** Change an existing link's settings; null when it is not on. The address stays the same. */
export async function changeTaskLink(itemId: string, organizationId: string, userId: string, patch: Partial<TaskLinkSettings>): Promise<TaskLinkRow | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.itemPublicLink.findUnique({ where: { itemId }, select: LINK_SELECT });
    if (!current) return null;
    const next: TaskLinkSettings = {
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt,
      showPeople: patch.showPeople !== undefined ? patch.showPeople : current.showPeople,
    };
    const same = (next.expiresAt?.getTime() ?? null) === (current.expiresAt?.getTime() ?? null) && next.showPeople === current.showPeople;
    if (same) return current;
    // updateMany: a link turned off a moment ago is "not on", not an error.
    const changed = await tx.itemPublicLink.updateMany({ where: { itemId }, data: next });
    if (changed.count === 0) return null;
    await recordLink(tx, "changed", { itemId, organizationId, userId, settings: next });
    return { ...current, ...next };
  });
}

/** Off: the row is gone, so no copy of the old address works again. */
export async function turnOffTaskLink(itemId: string, organizationId: string, userId: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const r = await tx.itemPublicLink.deleteMany({ where: { itemId } });
      if (r.count === 0) return false;
      await recordLink(tx, "off", { itemId, organizationId, userId, settings: null });
      return true;
    });
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

/** May this viewer turn a task's public link on or off, and see its address? */
export async function mayShareTaskPublicly(viewer: LinkViewer, task: { boardId: string; organizationId: string }): Promise<boolean> {
  if (task.organizationId !== viewer.organizationId) return false;
  if (viewerIsOrgAdmin(viewer)) return true;
  return canContributeFor(viewer, task.boardId);
}

/** How many Folders up the chain the Trash check walks: deeper trees are not made. */
const FOLDER_HOPS = 16;

/**
 * Where the task lives, as the link reads it: whether its home is a Personal
 * List, and whether that List, any Folder above it or its Space is in Trash.
 * (A task's own archivedAt is the caller's: it has the row already.)
 */
export async function taskLinkPlace(boardId: string): Promise<{ personal: boolean; inTrash: boolean }> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { archivedAt: true, productSlug: true, folderId: true, space: { select: { archivedAt: true } } },
  });
  if (!board) return { personal: false, inTrash: true };
  const personal = board.productSlug === "personal-list";
  if (board.archivedAt || board.space?.archivedAt) return { personal, inTrash: true };
  const seen = new Set<string>();
  let folderId = board.folderId;
  for (let hops = 0; folderId && hops < FOLDER_HOPS && !seen.has(folderId); hops += 1) {
    seen.add(folderId);
    const folder: { archivedAt: Date | null; parentFolderId: string | null } | null = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { archivedAt: true, parentFolderId: true },
    });
    if (!folder) break;
    if (folder.archivedAt) return { personal, inTrash: true };
    folderId = folder.parentFolderId;
  }
  return { personal, inTrash: false };
}
