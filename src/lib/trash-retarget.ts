// "Restore to...": a task snapshot pointed at a different List.
//
// Used when a task's own List is gone and the person restores it into one
// they can write to. Three things change on the way:
//   * the task and its subtasks get the new home;
//   * a captured link INTO the new home is dropped, because a task is never
//     both home in a List and linked into it;
//   * when the task WAS linked into the new home, that List's own field values
//     (its namespace, metadata.$lists[target]) are the ones the person has been
//     seeing there, so they come up to the top level exactly as a move would
//     do it (swapNamespacesOnMove), and the old home's values are parked in the
//     old home's namespace instead of being overwritten. Without this the
//     restore made the List the task's home while its values for that List
//     stayed in a namespace no home projection reads: kept, and shown nowhere.
//
// Pure: no database. The caller reads the old home's field keys, when that
// List still exists, before it opens the restore's transaction.

import { isReservedMetadataKey, isTaskLevelMetadataKey, swapNamespacesOnMove } from "./list-metadata";

type Row = Record<string, unknown>;

function asObject(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

/**
 * The keys the old home owns on one stored blob. Its schema when it is known;
 * when the old home is gone for good, every key that is neither reserved nor
 * task-level, so the move parks all of them rather than letting the new
 * home's values overwrite one of the same name.
 */
function homeKeysOf(metadata: unknown, fromKeys: readonly string[] | null): string[] {
  if (fromKeys) return [...fromKeys];
  return Object.keys(asObject(metadata)).filter((k) => !isReservedMetadataKey(k) && !isTaskLevelMetadataKey(k));
}

export function retargetTaskSnapshot(
  snapshot: unknown,
  boardId: string,
  opts: { fromKeys: readonly string[] | null } = { fromKeys: null },
): unknown {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const s = snapshot as { row?: Row; children?: { subtasks?: Row[]; listLinks?: Row[] } & Record<string, unknown> };
  const row = s.row;
  const rootId = typeof row?.id === "string" ? row.id : null;
  const fromBoardId = typeof row?.boardId === "string" ? row.boardId : null;
  const links = Array.isArray(s.children?.listLinks) ? s.children!.listLinks! : [];
  // Only the ROOT carries links; its subtasks are shown through it.
  const wasLinkedIntoTarget = !!rootId && fromBoardId !== boardId
    && links.some((l) => l && l.itemId === rootId && l.boardId === boardId);
  const swap = (md: unknown): unknown =>
    wasLinkedIntoTarget && fromBoardId
      ? swapNamespacesOnMove(md, { fromBoardId, toBoardId: boardId, fromKeys: homeKeysOf(md, opts.fromKeys) })
      : md;

  const children = s.children
    ? {
        ...s.children,
        ...(s.children.subtasks
          ? {
              subtasks: s.children.subtasks.map((t) => ({
                ...t,
                // A subtask on the root's home was shown in the target through
                // the root, so its values there come up with the root's. One
                // that had been moved elsewhere on its own was not.
                ...(t && t.boardId === fromBoardId && "metadata" in t ? { metadata: swap(t.metadata) } : {}),
                boardId,
              })),
            }
          : {}),
        ...(s.children.listLinks ? { listLinks: s.children.listLinks.filter((l) => l.boardId !== boardId) } : {}),
      }
    : undefined;
  return {
    ...s,
    ...(row ? { row: { ...row, ...("metadata" in row ? { metadata: swap(row.metadata) } : {}), boardId } } : {}),
    ...(children ? { children } : {}),
  };
}
