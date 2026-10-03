// The legacy reach of a person who is NOT the signed-in viewer: the author of
// an automation, answered live when their automation runs (spec-ai-automation
// 1.4, "a workflow never reaches further than its creator"). It lives here for
// the reason legacy-session.ts does: this directory is the one place allowed
// to read the access level, so callers get yes/no answers and never the level.
//
// It delegates to the same gates every List route uses today
// (getBoardForReaderOrFolderGrantee to read, canContributeBoard to write), so
// it changes no answer. Since the node access merge those two answer from the
// one node resolver (board.ts boardRoleOf, node-access): Can view to read,
// Can edit to write, the PRIVATE cut and the legacy floor included.
//
// Server-only (prisma).

import { prisma } from "../prisma";
import { canContributeBoard, getBoardForReaderOrFolderGrantee } from "../board";
import { legacyIsAdminLevel, legacyIsManagerLevel } from "./legacy-levels";

export interface LegacyReach {
  userId: string;
  /** Owner or Admin: reaches every List in the workspace. */
  admin: boolean;
  /** A manager or above (the legacy eight-level list). */
  manager: boolean;
  canRead(boardId: string): Promise<boolean>;
  canWrite(boardId: string): Promise<boolean>;
}

/** The person's reach, or null when they are not in this workspace at all. */
export async function legacyReachOf(organizationId: string, userId: string): Promise<LegacyReach | null> {
  const user = await prisma.user
    // A person removed from the workspace reaches no List: their row and
    // their old level stay for the record, never their reach.
    .findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { id: true, accessLevel: true } })
    .catch(() => null);
  if (!user) return null;
  const level = typeof user.accessLevel === "string" ? user.accessLevel : null;
  const admin = legacyIsAdminLevel(level);
  const reads = new Map<string, Promise<boolean>>();
  const writes = new Map<string, Promise<boolean>>();
  return {
    userId: user.id,
    admin,
    manager: legacyIsManagerLevel(level),
    canRead(boardId) {
      if (admin) return Promise.resolve(true);
      if (!reads.has(boardId)) {
        reads.set(boardId, getBoardForReaderOrFolderGrantee(boardId, user.id, level).then((b) => !!b).catch(() => false));
      }
      return reads.get(boardId)!;
    },
    canWrite(boardId) {
      if (admin) return Promise.resolve(true);
      if (!writes.has(boardId)) {
        writes.set(boardId, canContributeBoard(boardId, user.id, level).catch(() => false));
      }
      return writes.get(boardId)!;
    },
  };
}
