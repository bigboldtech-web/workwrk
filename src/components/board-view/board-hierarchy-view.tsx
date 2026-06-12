"use client";

// BoardHierarchyView — HIERARCHY renderer. Expand/collapse tree of
// parent → subtask chains (Item.parentItemId), the structure the table
// view nests inline. Depth-first; every node shows status + assignee
// and opens the drawer on click. Roots with no children still render
// as leaves so the view always covers the whole board.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ListTree } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { PersonAvatar } from "./assignee-picker";

interface BoardHierarchyViewProps {
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
}

export function BoardHierarchyView({ initialItems, statuses, onOpenItem }: BoardHierarchyViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { roots, childrenByParent } = useMemo(() => {
    const byParent = new Map<string, BoardItemRow[]>();
    const ids = new Set(initialItems.map((i) => i.id));
    const rootList: BoardItemRow[] = [];
    for (const it of initialItems) {
      // Treat orphans (parent filtered out / archived) as roots so they
      // never disappear from the tree.
      if (it.parentItemId && ids.has(it.parentItemId)) {
        const arr = byParent.get(it.parentItemId) ?? [];
        arr.push(it);
        byParent.set(it.parentItemId, arr);
      } else {
        rootList.push(it);
      }
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);
    rootList.sort((a, b) => a.position - b.position);
    return { roots: rootList, childrenByParent: byParent };
  }, [initialItems]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <ListTree className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">No items yet — add tasks and subtasks to grow the tree.</p>
      </div>
    );
  }

  const renderNode = (row: BoardItemRow, depth: number): React.ReactNode => {
    const children = childrenByParent.get(row.id) ?? [];
    const isCollapsed = collapsed.has(row.id);
    const opt = row.status ? statuses.find((o) => o.value === row.status) : null;
    return (
      <div key={row.id}>
        <div
          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 group"
          style={{ paddingLeft: 12 + depth * 22 }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(row.id)}
              className="inline-flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 shrink-0"
              aria-label={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4 h-4 shrink-0 flex items-center justify-center" aria-hidden>
              <span className="h-1 w-1 rounded-full bg-zinc-300" />
            </span>
          )}
          <button
            type="button"
            onClick={() => onOpenItem?.(row.id)}
            className="flex-1 min-w-0 text-left text-[13px] text-zinc-800 truncate hover:text-[var(--os-brand)]"
            title={row.title}
          >
            {row.title}
          </button>
          {children.length > 0 ? (
            <span className="text-[10.5px] text-zinc-400 tabular-nums shrink-0">{children.length}</span>
          ) : null}
          {opt ? (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium shrink-0"
              style={{ background: `${opt.color}22`, color: opt.color }}
            >
              {opt.label}
            </span>
          ) : null}
          {row.owner ? <PersonAvatar person={{ ...row.owner, email: null }} size={20} /> : null}
        </div>
        {!isCollapsed ? children.map((c) => renderNode(c, depth + 1)) : null}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white py-1.5 divide-y divide-zinc-50">
      {roots.map((r) => renderNode(r, 0))}
    </div>
  );
}
