"use client";

// BoardCardsView — CARDS renderer. The Monday-style ungrouped card
// gallery: every item as a visual card in a responsive grid (kanban
// minus the columns). Cards open the drawer; the description's first
// line gives each card a body so the gallery reads as more than a
// title list.

import { LayoutGrid } from "lucide-react";
import { isDoneStatus, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import { PersonAvatar } from "./assignee-picker";
import { PriorityFlag } from "./priority-picker";
import { TagChip } from "./tag-picker";

interface BoardCardsViewProps {
  initialItems: BoardItemRow[];
  statuses: StatusOption[];
  onOpenItem?: (itemId: string) => void;
}

export function BoardCardsView({ initialItems, statuses, onOpenItem }: BoardCardsViewProps) {
  if (initialItems.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-14 text-center">
        <LayoutGrid className="w-8 h-8 mx-auto text-zinc-300 mb-3" />
        <p className="text-[12.5px] text-zinc-500">No items yet — new tasks show up here as cards.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {initialItems.map((it) => {
        const opt = it.status ? statuses.find((o) => o.value === it.status) : null;
        const due = it.dueAt ? new Date(it.dueAt) : null;
        const overdue = !!due && due < new Date() && !isDoneStatus(statuses, it.status);
        const desc = typeof it.metadata?.description === "string" ? (it.metadata.description as string) : "";
        const tags = it.tags ?? [];
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onOpenItem?.(it.id)}
            className="flex flex-col text-left rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 hover:shadow-sm transition-all"
            style={opt ? { borderTop: `3px solid ${opt.color}` } : undefined}
          >
            <div className="text-[13px] font-medium text-zinc-900 break-words">{it.title}</div>
            {desc ? (
              <p className="mt-1 text-[11.5px] text-zinc-500 line-clamp-2">{desc}</p>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {opt ? (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                  style={{ background: `${opt.color}22`, color: opt.color }}
                >
                  {opt.label}
                </span>
              ) : null}
              {it.priority ? <PriorityFlag value={it.priority} /> : null}
              {tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
              {tags.length > 2 ? <span className="text-[10.5px] text-zinc-500">+{tags.length - 2}</span> : null}
            </div>
            <div className="mt-auto pt-2 flex items-center justify-between text-[11px] text-zinc-500">
              {it.owner ? (
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <PersonAvatar person={{ ...it.owner, email: null }} size={18} />
                  <span className="truncate max-w-[110px]">
                    {`${it.owner.firstName ?? ""} ${it.owner.lastName ?? ""}`.trim()}
                  </span>
                </span>
              ) : (
                <span>Unassigned</span>
              )}
              {due ? (
                <span className={overdue ? "font-medium text-red-600" : ""}>
                  {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
