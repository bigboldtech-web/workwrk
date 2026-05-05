"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Inbox, Layers, Plus, Pencil, Trash2, Folder, Tag } from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";

export interface CategoryNode {
  id: string;
  name: string;
  subcategories: { id: string; name: string; sopCount?: number }[];
  sopCount?: number;
}

/**
 * Filter values understood by the SOPs page:
 *   "all"            — every SOP
 *   "uncategorized"  — SOPs with no category set
 *   "<name>"         — every SOP with `category = <name>`
 *   "<cat>::<sub>"   — every SOP with `category = <cat>` AND `subcategory = <sub>`
 *
 * We use "::" as a separator because user-typed names rarely contain it.
 */
export type CategoryFilterValue = "all" | "uncategorized" | string;

interface Props {
  categories: CategoryNode[];
  /** Total active SOPs (excluding ARCHIVED). Drives the "All SOPs" pill. */
  totalSops: number;
  /** Count of SOPs without a category. Drives the "Uncategorized" pill. */
  uncategorizedCount?: number;
  selected: CategoryFilterValue;
  onSelect: (value: CategoryFilterValue) => void;
  /** Optional: drag SOPs onto a category to set their category+subcategory. */
  onDropSop?: (categoryName: string, subcategoryName: string | null, sopId: string) => void;
  /** Admin actions; if any are passed the right-click menu is shown. */
  onCreateCategory?: () => void;
  onAddSubcategory?: (category: CategoryNode) => void;
  onRenameCategory?: (category: CategoryNode) => void;
  onDeleteCategory?: (category: CategoryNode) => void;
  onRenameSubcategory?: (category: CategoryNode, subId: string, subName: string) => void;
  onDeleteSubcategory?: (category: CategoryNode, subId: string, subName: string) => void;
  canManage?: boolean;
}

/**
 * Sidebar tree of categories + their subcategories. Drop-in replacement
 * for the previous folder tree as the primary navigation on /sops.
 *
 * Selecting a top-level category narrows the list to all its SOPs;
 * picking a subcategory narrows further. Clicking the same node again
 * is a no-op (filter-only, never a "deselect to all").
 */
export function CategoryTree({
  categories, totalSops, uncategorizedCount, selected, onSelect, onDropSop,
  onCreateCategory, onAddSubcategory, onRenameCategory, onDeleteCategory,
  onRenameSubcategory, onDeleteSubcategory, canManage,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function toggle(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleDragOver(e: React.DragEvent, target: string) {
    if (!onDropSop) return;
    if (e.dataTransfer.types.includes("application/x-sop-id")) {
      e.preventDefault();
      setDropTarget(target);
    }
  }
  function handleDrop(e: React.DragEvent, category: string, subcategory: string | null) {
    if (!onDropSop) return;
    const sopId = e.dataTransfer.getData("application/x-sop-id");
    if (sopId) {
      e.preventDefault();
      onDropSop(category, subcategory, sopId);
    }
    setDropTarget(null);
  }

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  return (
    <div className="flex flex-col gap-0.5">
      {/* Pseudo-node: every active SOP. */}
      <div
        onClick={() => onSelect("all")}
        className={[
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 pl-[20px] text-[12.5px] cursor-pointer select-none",
          selected === "all" ? "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground",
        ].join(" ")}
      >
        <Layers size={12} className="text-muted" />
        <span className="flex-1">All SOPs</span>
        <span className="text-[10px] font-mono tabular-nums text-muted">{totalSops}</span>
      </div>

      {/* Pseudo-node: SOPs with no category. */}
      <div
        onClick={() => onSelect("uncategorized")}
        className={[
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 pl-[20px] text-[12.5px] cursor-pointer select-none",
          selected === "uncategorized" ? "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground",
        ].join(" ")}
      >
        <Inbox size={12} className="text-muted" />
        <span className="flex-1">Uncategorized</span>
        {typeof uncategorizedCount === "number" && (
          <span className="text-[10px] font-mono tabular-nums text-muted">{uncategorizedCount}</span>
        )}
      </div>

      <div className="my-1 border-t border-border" />

      {sortedCategories.length === 0 ? (
        <div className="px-2 py-3 text-[11px] text-muted">
          No categories yet.{canManage ? " Create one below to start organising." : ""}
        </div>
      ) : sortedCategories.map((cat) => {
        const isOpen = !collapsed.has(cat.name);
        const isSelected = selected === cat.name;
        const isDrop = dropTarget === cat.name;
        const subs = [...cat.subcategories].sort((a, b) => a.name.localeCompare(b.name));

        const row = (
          <div
            onDragOver={(e) => handleDragOver(e, cat.name)}
            onDragLeave={() => setDropTarget((p) => (p === cat.name ? null : p))}
            onDrop={(e) => handleDrop(e, cat.name, null)}
            onClick={() => onSelect(cat.name)}
            className={[
              "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] cursor-pointer select-none",
              isSelected ? "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground",
              isDrop ? "ring-1 ring-[#d4ff2e] ring-inset" : "",
            ].join(" ")}
            style={{ paddingLeft: 6 }}
          >
            {subs.length > 0 ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(cat.name); }}
                className="flex h-4 w-4 items-center justify-center text-muted hover:text-foreground"
                aria-label={isOpen ? "Collapse" : "Expand"}
              >
                <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="h-4 w-4" />
            )}
            <Folder size={12} className="text-muted shrink-0" />
            <span className="truncate flex-1">{cat.name}</span>
            <span className="text-[10px] font-mono tabular-nums text-muted">
              {cat.sopCount ?? 0}
            </span>
          </div>
        );

        return (
          <div key={cat.name}>
            {canManage ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                <ContextMenuContent>
                  {onAddSubcategory && (
                    <ContextMenuItem onClick={() => onAddSubcategory(cat)}>
                      <Plus size={12} /> Add subcategory
                    </ContextMenuItem>
                  )}
                  {onRenameCategory && (
                    <ContextMenuItem onClick={() => onRenameCategory(cat)}>
                      <Pencil size={12} /> Rename category
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  {onDeleteCategory && (
                    <ContextMenuItem
                      onClick={() => onDeleteCategory(cat)}
                      className="text-red-400 focus:text-red-300"
                    >
                      <Trash2 size={12} /> Delete category
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            ) : row}

            {isOpen && subs.map((sub) => {
              const subKey = `${cat.name}::${sub.name}`;
              const subSelected = selected === subKey;
              const subDrop = dropTarget === subKey;

              const subRow = (
                <div
                  onDragOver={(e) => handleDragOver(e, subKey)}
                  onDragLeave={() => setDropTarget((p) => (p === subKey ? null : p))}
                  onDrop={(e) => handleDrop(e, cat.name, sub.name)}
                  onClick={() => onSelect(subKey)}
                  className={[
                    "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] cursor-pointer select-none ml-4",
                    subSelected ? "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground",
                    subDrop ? "ring-1 ring-[#d4ff2e] ring-inset" : "",
                  ].join(" ")}
                >
                  <span className="h-4 w-4" />
                  <Tag size={11} className="text-muted shrink-0" />
                  <span className="truncate flex-1">{sub.name}</span>
                  <span className="text-[10px] font-mono tabular-nums text-muted">
                    {sub.sopCount ?? 0}
                  </span>
                </div>
              );

              return canManage ? (
                <ContextMenu key={subKey}>
                  <ContextMenuTrigger asChild>{subRow}</ContextMenuTrigger>
                  <ContextMenuContent>
                    {onRenameSubcategory && (
                      <ContextMenuItem onClick={() => onRenameSubcategory(cat, sub.id, sub.name)}>
                        <Pencil size={12} /> Rename subcategory
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    {onDeleteSubcategory && (
                      <ContextMenuItem
                        onClick={() => onDeleteSubcategory(cat, sub.id, sub.name)}
                        className="text-red-400 focus:text-red-300"
                      >
                        <Trash2 size={12} /> Delete subcategory
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ) : <div key={subKey}>{subRow}</div>;
            })}
          </div>
        );
      })}

      {canManage && onCreateCategory && (
        <button
          type="button"
          onClick={onCreateCategory}
          className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          <Plus size={12} /> New category
        </button>
      )}
    </div>
  );
}
