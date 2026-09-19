// notification-readability.ts — can the viewer still open what this
// notification points at, and if not, why.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, "Target the
// viewer can no longer open"): the pane never 404s and never shows a locked
// object's contents; it renders the notification's own stored title and
// message with one sentence saying which case it is, and no Open button.
// "The server decides this, not the client."
//
// WHY IT MATTERS MORE THAN IT LOOKS. A notification is a permanent record of
// something that happened to you, written at a moment when you could see the
// thing. Tasks get deleted, Lists get restricted, people leave. The row must
// stay in the list and stay clearable — hiding it would leave an unread count
// that cannot be cleared — while the pane stops pretending the object is still
// there.
//
// It is deliberately ONE batched query per kind, and it resolves only the
// kinds a notification can actually point at. Anything it does not know about
// comes back absent from the map, which the caller reads as "openable": an
// external href or a route with no object behind it is not a locked object.

import { prisma } from "@/lib/prisma";
import { docAccessible } from "@/lib/doc-access";
import type { NotificationTarget, TargetKind, UnreadableReason } from "./notification-target";

export interface TargetVerdict {
  readable: boolean;
  reason: UnreadableReason | null;
}

/** `"item:abc"` — the key both this map and the caller build. */
export function targetKey(target: Pick<NotificationTarget, "kind" | "id">): string {
  return `${target.kind}:${target.id ?? ""}`;
}

/** The kinds this module resolves. Everything else is left openable. */
const RESOLVED: readonly TargetKind[] = ["item", "board", "space", "folder", "doc", "sop"];

/**
 * A verdict per distinct target. Absent from the map = nothing to check.
 *
 * The three reasons, in the words the pane prints:
 *   deleted   the row is gone from the table entirely
 *   moved     the row exists but is archived / in the Trash
 *   no_access the row exists and is live, and this viewer cannot read it
 */
export async function readableTargets(
  userId: string,
  organizationId: string,
  targets: readonly NotificationTarget[],
  accessLevel?: string | null,
): Promise<Map<string, TargetVerdict>> {
  const out = new Map<string, TargetVerdict>();
  if (!organizationId) return out;

  const byKind = new Map<TargetKind, Set<string>>();
  for (const t of targets) {
    if (!t.id || !RESOLVED.includes(t.kind)) continue;
    const set = byKind.get(t.kind) ?? new Set<string>();
    set.add(t.id);
    byKind.set(t.kind, set);
  }
  if (byKind.size === 0) return out;

  await Promise.all([
    resolveItems(out, userId, organizationId, byKind.get("item")),
    resolveBoards(out, userId, organizationId, byKind.get("board")),
    resolveSpaces(out, userId, organizationId, byKind.get("space")),
    resolveFolders(out, userId, organizationId, byKind.get("folder")),
    resolveDocs(out, userId, organizationId, accessLevel, byKind.get("doc")),
    resolveSops(out, organizationId, byKind.get("sop")),
  ]);

  return out;
}

function verdictsFor(
  out: Map<string, TargetVerdict>,
  kind: TargetKind,
  asked: Set<string>,
  alive: Map<string, { archived: boolean; readable: boolean }>,
): void {
  for (const id of asked) {
    const row = alive.get(id);
    if (!row) out.set(`${kind}:${id}`, { readable: false, reason: "deleted" });
    else if (row.archived) out.set(`${kind}:${id}`, { readable: false, reason: "moved" });
    else if (!row.readable) out.set(`${kind}:${id}`, { readable: false, reason: "no_access" });
    else out.set(`${kind}:${id}`, { readable: true, reason: null });
  }
}

async function resolveItems(out: Map<string, TargetVerdict>, userId: string, organizationId: string, ids?: Set<string>) {
  if (!ids?.size) return;
  const rows = await prisma.item.findMany({
    where: { id: { in: [...ids] }, organizationId },
    select: {
      id: true, archivedAt: true, ownerId: true, assigneeIds: true,
      board: {
        select: {
          id: true, archivedAt: true, visibility: true,
          members: { where: { userId }, select: { userId: true } },
          space: { select: { visibility: true, archivedAt: true, members: { where: { userId }, select: { userId: true } } } },
        },
      },
    },
  });
  const alive = new Map<string, { archived: boolean; readable: boolean }>();
  for (const r of rows) {
    // Access rule 9: being assigned a task grants Can edit on that task, List
    // membership or no. The task page short-circuits on exactly this, so the
    // Inbox must agree with it or an assignee is told they cannot open a task
    // that opens perfectly well.
    const mine = r.ownerId === userId || (r.assigneeIds ?? []).includes(userId);
    const board = r.board;
    const listReadable =
      !!board &&
      board.archivedAt === null &&
      (board.members.length > 0 ||
        (board.space ? board.space.visibility === "ORG" || board.space.members.length > 0 : false));
    alive.set(r.id, { archived: r.archivedAt !== null, readable: mine || listReadable });
  }
  verdictsFor(out, "item", ids, alive);
}

async function resolveBoards(out: Map<string, TargetVerdict>, userId: string, organizationId: string, ids?: Set<string>) {
  if (!ids?.size) return;
  // A board link carries the SLUG, not the id, so both are matched.
  const rows = await prisma.board.findMany({
    where: { organizationId, OR: [{ id: { in: [...ids] } }, { slug: { in: [...ids] } }] },
    select: {
      id: true, slug: true, archivedAt: true,
      members: { where: { userId }, select: { userId: true } },
      space: { select: { visibility: true, members: { where: { userId }, select: { userId: true } } } },
    },
  });
  const alive = new Map<string, { archived: boolean; readable: boolean }>();
  for (const r of rows) {
    const readable =
      r.members.length > 0 || (r.space ? r.space.visibility === "ORG" || r.space.members.length > 0 : false);
    const value = { archived: r.archivedAt !== null, readable };
    alive.set(r.id, value);
    alive.set(r.slug, value);
  }
  verdictsFor(out, "board", ids, alive);
}

async function resolveSpaces(out: Map<string, TargetVerdict>, userId: string, organizationId: string, ids?: Set<string>) {
  if (!ids?.size) return;
  const rows = await prisma.space.findMany({
    where: { organizationId, OR: [{ id: { in: [...ids] } }, { slug: { in: [...ids] } }] },
    select: {
      id: true, slug: true, archivedAt: true, visibility: true,
      members: { where: { userId }, select: { userId: true } },
    },
  });
  const alive = new Map<string, { archived: boolean; readable: boolean }>();
  for (const r of rows) {
    const value = { archived: r.archivedAt !== null, readable: r.visibility === "ORG" || r.members.length > 0 };
    alive.set(r.id, value);
    alive.set(r.slug, value);
  }
  verdictsFor(out, "space", ids, alive);
}

async function resolveFolders(out: Map<string, TargetVerdict>, userId: string, organizationId: string, ids?: Set<string>) {
  if (!ids?.size) return;
  const rows = await prisma.folder.findMany({
    where: { id: { in: [...ids] }, organizationId },
    select: {
      id: true, archivedAt: true,
      members: { where: { userId }, select: { userId: true } },
      space: { select: { visibility: true, members: { where: { userId }, select: { userId: true } } } },
    },
  });
  const alive = new Map<string, { archived: boolean; readable: boolean }>();
  for (const r of rows) {
    const readable =
      r.members.length > 0 || (r.space ? r.space.visibility === "ORG" || r.space.members.length > 0 : false);
    alive.set(r.id, { archived: r.archivedAt !== null, readable });
  }
  verdictsFor(out, "folder", ids, alive);
}

async function resolveDocs(
  out: Map<string, TargetVerdict>,
  userId: string,
  organizationId: string,
  accessLevel: string | null | undefined,
  ids?: Set<string>,
) {
  if (!ids?.size) return;
  const rows = await prisma.doc.findMany({
    where: { id: { in: [...ids] }, organizationId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true },
  });
  // `docAccessible` is the same gate the Docs pages use, so this answer can
  // never be wider than what /docs/[id] itself would allow.
  const verdicts = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      archived: r.archivedAt !== null,
      readable: await docAccessible({ entityType: r.entityType, entityId: r.entityId }, userId, accessLevel),
    })),
  );
  const alive = new Map<string, { archived: boolean; readable: boolean }>();
  for (const v of verdicts) alive.set(v.id, { archived: v.archived, readable: v.readable });
  verdictsFor(out, "doc", ids, alive);
}

async function resolveSops(out: Map<string, TargetVerdict>, organizationId: string, ids?: Set<string>) {
  if (!ids?.size) return;
  const rows = await prisma.sOP.findMany({
    where: { id: { in: [...ids] }, organizationId },
    select: { id: true },
  });
  const alive = new Map<string, { archived: boolean; readable: boolean }>();
  for (const r of rows) alive.set(r.id, { archived: false, readable: true });
  verdictsFor(out, "sop", ids, alive);
}
