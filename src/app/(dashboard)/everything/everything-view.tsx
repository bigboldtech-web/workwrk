"use client";

// Everything view — thin client wrapper around the shared
// board-table-view in clean List mode, grouped by status. Read-only
// (canEdit=false): clicking a row title opens the full /item/[id]
// page; the source-List chip after each title links to its board.

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { List } from "lucide-react";
import { BoardTableView } from "@/components/board-view/board-table-view";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow } from "@/lib/board-items-shared";
import type { EverythingItem } from "@/lib/everything";

export function EverythingView({
  items,
  currentUserId,
}: {
  items: EverythingItem[];
  currentUserId: string;
}) {
  const router = useRouter();

  // itemId → source board, for the per-row List chip. Unknown statuses
  // (per-List sets beyond the default trio) render as gray orphan
  // buckets inside the table — no need to union every board's set here.
  const boardByItem = useMemo(
    () => new Map(items.map((it) => [it.id, it.board] as const)),
    [items],
  );

  const renderTitleSuffix = useCallback(
    (row: BoardItemRow) => {
      const board = boardByItem.get(row.id);
      if (!board) return null;
      return (
        <Link
          href={`/boards/${board.slug}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 shrink-0 max-w-[160px] h-[18px] px-1.5 rounded bg-zinc-100 text-[11.5px] text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 transition-colors"
          title={`Open List: ${board.name}`}
        >
          <List className="w-3 h-3 shrink-0" />
          <span className="truncate">{board.name}</span>
        </Link>
      );
    },
    [boardByItem],
  );

  return (
    <BoardTableView
      // Read-only cross-board surface — there is no single source board.
      // canEdit=false hides every mutation control, and viewId=null makes
      // view-config persistence a no-op, so this id is never fetched.
      boardId="everything"
      viewId={null}
      viewConfig={{ groupBy: "status" }}
      initialItems={items}
      initialFields={[]}
      statuses={[...DEFAULT_STATUS_OPTIONS]}
      canEdit={false}
      currentUserId={currentUserId}
      onOpenItem={(itemId) => router.push(`/item/${itemId}`)}
      renderTitleSuffix={renderTitleSuffix}
      gridStyle="list"
    />
  );
}
