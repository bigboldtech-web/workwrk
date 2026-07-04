"use client";

// SpaceListItemsTable — the interactive rows for the Space "List" tab. Brings
// the cross-board aggregate to parity with the board List: the progress status
// circle before the title, a row that opens the item in the big centered popup
// (BoardItemDrawer) instead of navigating away, and hover actions.

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { StatusGlyph } from "@/components/board-view/status-glyph";
import { BoardItemDrawer } from "@/components/board-view/board-item-drawer";
import type { StatusOption } from "@/lib/board-items-shared";

export interface SpaceListRow {
  id: string;
  title: string;
  status: string | null;
  ownerId: string | null;
  parentItemId: string | null;
  updatedAt: string | Date;
  board: { slug: string; name: string };
}

function timeAgo(d: string | Date): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return t.toLocaleDateString();
}

export function SpaceListItemsTable({
  items,
  statuses,
  canEdit,
  currentUserId,
}: {
  items: SpaceListRow[];
  statuses: StatusOption[];
  canEdit: boolean;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // Start expanded so subtasks are immediately visible nested under their
  // parent (the caret collapses them). Seeds from the parents present on mount.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.parentItemId).map((i) => i.parentItemId as string)),
  );
  const byValue = new Map(statuses.map((s) => [s.value, s]));

  // Nest subtasks under their parent. A subtask whose parent isn't in this set
  // (e.g. filtered out) is promoted to top-level so it's never lost. Collapsed
  // by default (ClickUp) — the caret + count marks a task that has subtasks.
  const { topLevel, childrenByParent } = useMemo(() => {
    const present = new Set(items.map((i) => i.id));
    const byParent = new Map<string, SpaceListRow[]>();
    const top: SpaceListRow[] = [];
    for (const it of items) {
      if (it.parentItemId && present.has(it.parentItemId)) {
        const arr = byParent.get(it.parentItemId) ?? [];
        arr.push(it);
        byParent.set(it.parentItemId, arr);
      } else {
        top.push(it);
      }
    }
    return { topLevel: top, childrenByParent: byParent };
  }, [items]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const renderRow = (it: SpaceListRow, depth: number): ReactNode[] => {
    const current = it.status ? byValue.get(it.status) ?? null : null;
    const statusColor = current?.color ?? "#A1A1AA";
    const statusLabel = current?.label ?? (it.status ?? "—");
    const kids = childrenByParent.get(it.id) ?? [];
    const isOpen = expanded.has(it.id);
    const rows: ReactNode[] = [
      <tr key={it.id} className="group hover:bg-zinc-50">
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: depth * 22 }}>
            {kids.length > 0 ? (
              <button
                type="button"
                onClick={() => toggle(it.id)}
                className="inline-flex items-center justify-center w-4 h-4 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 shrink-0"
                aria-label={isOpen ? "Collapse subtasks" : "Expand subtasks"}
              >
                <svg viewBox="0 0 8 8" className={`w-[10px] h-[10px] fill-current transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                  <path d="M2 1 L6 4 L2 7 Z" />
                </svg>
              </button>
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              onClick={() => setOpenItemId(it.id)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left"
              title={it.title}
            >
              <StatusGlyph current={current} statuses={statuses} />
              <span className={`truncate hover:text-[var(--os-brand)] transition-colors ${depth > 0 ? "text-[12.5px] text-zinc-700" : "text-[13px] font-medium text-zinc-900"}`}>
                {it.title}
              </span>
              {kids.length > 0 ? (
                <span className="inline-flex items-center px-1.5 h-4 rounded-full bg-zinc-100 text-[10px] font-medium text-zinc-500 shrink-0">
                  {kids.length}
                </span>
              ) : null}
            </button>
            <Link
              href={`/boards/${it.board.slug}?item=${it.id}`}
              className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 shrink-0"
              title="Open in its board"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </td>
        <td className="px-3 py-2">
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
            style={{ backgroundColor: `${statusColor}1a`, color: statusColor }}
          >
            {statusLabel}
          </span>
        </td>
        <td className="px-3 py-2 hidden sm:table-cell">
          <Link
            href={`/boards/${it.board.slug}`}
            className="text-[12px] text-zinc-600 hover:text-zinc-900 truncate inline-block max-w-[200px]"
          >
            {it.board.name}
          </Link>
        </td>
        <td className="px-3 py-2 text-right text-[11px] text-zinc-500 tabular-nums">
          {timeAgo(it.updatedAt)}
        </td>
      </tr>,
    ];
    if (isOpen) {
      for (const kid of kids) rows.push(...renderRow(kid, depth + 1));
    }
    return rows;
  };

  return (
    <>
      <table className="w-full">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium hidden sm:table-cell">Board</th>
            <th className="px-3 py-2 font-medium text-right tabular-nums">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {topLevel.map((it) => renderRow(it, 0))}
        </tbody>
      </table>

      <BoardItemDrawer
        itemId={openItemId}
        canEdit={canEdit}
        currentUserId={currentUserId}
        statuses={statuses}
        onClose={() => setOpenItemId(null)}
        onItemChanged={() => router.refresh()}
        onItemArchived={() => { setOpenItemId(null); router.refresh(); }}
      />
    </>
  );
}
