// The rules a reminder or digest sweep over tasks follows
// (/api/email/send-reminders: the daily due-today run and the Monday overdue
// digest), so the two runs agree on which tasks count and who hears of them.
//
//   - A task counts only in a List someone can still see in the app: not
//     archived, not under an archived Space or Folder (at any depth), and
//     not a List the product keeps for itself (the hidden Meetings List,
//     whose Items are meetings, never tasks: src/lib/system-items.ts).
//     Archiving a Space or Folder writes only its own row, so its Lists
//     keep `archivedAt` null; the sweep walks up to find it.
//   - Every assignee hears of it, not only the first one: `ownerId` is the
//     first of `assigneeIds`, and older rows may hold only `ownerId`.
//   - Only a live person in this workspace: not removed, not deactivated,
//     and anchored here or a member here.
//
// Pure: no Prisma import.

import { isSystemBoard, isSystemItemType } from "@/lib/system-items";

export interface SweepBoard {
  id: string;
  archivedAt?: Date | null;
  spaceId?: string | null;
  folderId?: string | null;
  settings?: unknown;
  itemType?: string | null;
}
export interface SweepSpace { id: string; parentSpaceId?: string | null; archivedAt?: Date | null }
export interface SweepFolder { id: string; parentFolderId?: string | null; spaceId?: string | null; archivedAt?: Date | null }

/**
 * Ids whose row, or any row above it, is archived. A loop in the tree stops
 * the walk.
 *
 * WHY THE MEMO IS EXACT, LOOPS INCLUDED (docs-found fixes batch 4: a review
 * asked whether a "live" answer remembered for a node inside a loop could be
 * wrong). Each row has ONE parent, so a walk is a single path, and a walk
 * that comes back to a node it has seen has gone round the whole loop. It
 * stops at the first archived row, and answers true for every row before
 * it. So a remembered false means no row from that one to the end of the
 * walk is archived, and on a loop that end is the whole loop: every member
 * is truly live. src/lib/reminder-sweep.test.ts checks it against a plain
 * walk over every tree of up to four rows, in the orders the rows arrive.
 */
function archivedWithAncestors<T extends { id: string; archivedAt?: Date | null }>(rows: readonly T[], parentOf: (r: T) => string | null | undefined): Set<string> {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const memo = new Map<string, boolean>();
  const dead = (id: string, seen: Set<string>): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const r = byId.get(id);
    if (!r || seen.has(id)) return false;
    seen.add(id);
    const parent = parentOf(r);
    const out = Boolean(r.archivedAt) || (parent ? dead(parent, seen) : false);
    memo.set(id, out);
    return out;
  };
  return new Set(rows.filter((r) => dead(r.id, new Set())).map((r) => r.id));
}

/** The Lists a sweep reads: live, and in no archived place. */
export function sweepBoards<B extends SweepBoard>(boards: readonly B[], spaces: readonly SweepSpace[], folders: readonly SweepFolder[]): B[] {
  const deadSpaces = archivedWithAncestors(spaces, (s) => s.parentSpaceId);
  const deadFolders = archivedWithAncestors(folders, (f) => f.parentFolderId);
  const folderSpace = new Map(folders.map((f) => [f.id, f.spaceId ?? null] as const));
  return boards.filter((b) => {
    if (b.archivedAt || isSystemBoard(b)) return false;
    if (b.spaceId && deadSpaces.has(b.spaceId)) return false;
    if (b.folderId) {
      if (deadFolders.has(b.folderId)) return false;
      const fs = folderSpace.get(b.folderId);
      if (fs && deadSpaces.has(fs)) return false;
    }
    return true;
  });
}

/** Is this row a task (not a meeting or another Item the product writes for itself)? */
export function isSweepTask(row: { itemType?: string | null }): boolean {
  return !isSystemItemType(row.itemType);
}

/** Everyone a task is assigned to, each once: the first assignee and the rest. */
export function taskPeople(row: { ownerId?: string | null; assigneeIds?: readonly string[] | null }): string[] {
  return [...new Set([row.ownerId, ...(row.assigneeIds ?? [])].filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** The `where` that keeps a task with anyone assigned (the first assignee, or any other). */
export const HAS_ASSIGNEE = { OR: [{ ownerId: { not: null } }, { NOT: { assigneeIds: { isEmpty: true } } }] };

export interface SweepPerson {
  id: string;
  deletedAt?: Date | null;
  status?: string | null;
  organizationId?: string | null;
  organizationMemberships?: ReadonlyArray<unknown> | null;
}

/** A person who is live and in this workspace (anchored here, or a member here). */
export function liveInWorkspace(p: SweepPerson | null | undefined, organizationId: string): boolean {
  if (!p || p.deletedAt || p.status === "INACTIVE") return false;
  return p.organizationId === organizationId || (p.organizationMemberships?.length ?? 0) > 0;
}
