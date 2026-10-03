// A task's public, view-only link (access-model toggle 10, "Public links").
//
// The link is /share/task/<itemId>.<secret>. The secret lives in its own
// table ("ItemPublicLink", prisma/sql/2026-10-04-item-public-link.sql), never
// in the task's metadata, which reaches every reader in every row payload.
//
// WHO. Anyone who may share the task turns it on and off and sees the
// address: an org Owner or Admin, or someone who may add to its home List
// (the add rule a share into another List already uses, linkedRowAccess
// canShare). Turning it on also needs the workspace to allow public links
// (toggle 10) and a live task. A reader who reaches the task only through a
// List it is linked into may not: the home is not theirs.
//
// WHAT THE PAGE SHOWS, and never more (src/app/api/public/tasks/[token]):
// the task's title, status, priority, dates, description as plain text,
// checklist, and its subtasks' titles and statuses; assignees by first name.
// Never comments, attachments, activity, custom fields, connected tasks, the
// List or Space it is in, or any email.
//
// OFF deletes the row, so turning it on again mints a NEW secret and an old
// copy of the link never comes back. The workspace switch off, an archived
// task or a deleted one makes every link answer the one "invalid or turned
// off" sentence without deleting anything.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { newPublicSecret } from "@/lib/doc-sharing";
import { canContributeFor, viewerIsOrgAdmin, type LinkViewer } from "@/lib/list-links-server";

export const TASK_SHARE_PATH = "/share/task/";

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

/** A missing table (the SQL file not applied yet) reads as "no link". */
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P2021" || (err instanceof Error && /ItemPublicLink/.test(err.message) && /does not exist/i.test(err.message));
}

export async function readTaskLink(itemId: string): Promise<{ secret: string; createdAt: Date } | null> {
  try {
    return await prisma.itemPublicLink.findUnique({ where: { itemId }, select: { secret: true, createdAt: true } });
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** On: the existing secret when it is already on, else a new one. */
export async function turnOnTaskLink(itemId: string, organizationId: string, userId: string): Promise<{ secret: string; created: boolean }> {
  const existing = await readTaskLink(itemId);
  if (existing) return { secret: existing.secret, created: false };
  const secret = newPublicSecret();
  try {
    await prisma.itemPublicLink.create({ data: { itemId, organizationId, secret, createdById: userId } });
    return { secret, created: true };
  } catch (err) {
    // Two people turned it on at once: the first one's link stands.
    const again = await readTaskLink(itemId);
    if (again) return { secret: again.secret, created: false };
    throw err;
  }
}

/** Off: the row is gone, so no copy of the old address works again. */
export async function turnOffTaskLink(itemId: string): Promise<boolean> {
  try {
    const r = await prisma.itemPublicLink.deleteMany({ where: { itemId } });
    return r.count > 0;
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
