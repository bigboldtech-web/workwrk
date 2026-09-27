"use client";

// LinkedRowIndicator: the small grey chip a row or a card carries when it is
// shown in this List THROUGH A LINK (decision 7, ClickUp's "also in" marker).
// It names the task's home List and links to it, only when the viewer can
// read that List; otherwise it is the glyph alone, which says "this task lives
// somewhere else" and names nothing the viewer may not see. Home rows and
// subtasks shown through their parent carry nothing.

import Link from "next/link";
import { Layers } from "lucide-react";
import type { BoardItemRow } from "@/lib/board-items-shared";
import { linkedRowKind } from "@/lib/list-link-rows";

const CHIP = "inline-flex h-5 max-w-[168px] shrink-0 items-center gap-1 rounded-[5px] bg-subtle px-1.5 text-xs font-medium text-ink-2";

export function LinkedRowIndicator({ row, boardId }: { row: BoardItemRow; boardId: string }) {
  if (linkedRowKind(row, boardId) !== "linked-root") return null;
  const home = row.listLink?.homeList ?? null;
  if (!home) {
    return (
      <span className={CHIP} title="Also in another List" aria-label="Also in another List">
        <Layers className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      </span>
    );
  }
  return (
    <Link
      href={`/boards/${home.slug}`}
      prefetch={false}
      // The chip sits inside a clickable row: opening the home List must not
      // also open the task.
      onClick={(e) => e.stopPropagation()}
      className={`${CHIP} transition-colors hover:bg-hover hover:text-ink`}
      title={`Home List: ${home.name}`}
    >
      <Layers className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span className="truncate">{home.name}</span>
    </Link>
  );
}
