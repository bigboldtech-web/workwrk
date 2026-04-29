"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FolderOpen, Folder as FolderIcon, Inbox, Layers, Plus, MoreHorizontal, Pencil, Users as UsersIcon, Trash2 } from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";

export interface FolderNode {
  id: string;
  name: string;
  color: string | null;
  icon?: string | null;
  description?: string | null;
  parentId: string | null;
  _count: { sops: number; access: number };
  /** Rolled-up count: this folder + every descendant. Server-computed. */
  sopCountDeep: number;
}

/**
 * Special filter values reserved alongside real folder ids:
 *   "all"  — every visible SOP (default)
 *   "none" — only SOPs not in any folder ("Unfoldered")
 */
export type FolderFilterValue = "all" | "none" | string;

interface Props {
  folders: FolderNode[];
  totalSops: number;
  unfolderedCount?: number;
  selected: FolderFilterValue;
  onSelect: (value: FolderFilterValue) => void;
  /** Called when an SOP is dropped onto a folder node. */
  onDropSop?: (folderId: string | null, sopId: string) => void;
  /** Admin actions. If omitted, the right-click menu is hidden. */
  onCreateChild?: (parentId: string | null) => void;
  onRename?: (folder: FolderNode) => void;
  onManageAccess?: (folder: FolderNode) => void;
  onDelete?: (folder: FolderNode) => void;
  canManage?: boolean;
}

export function FolderTree({
  folders, totalSops, unfolderedCount, selected, onSelect,
  onDropSop, onCreateChild, onRename, onManageAccess, onDelete, canManage,
}: Props) {
  // Build child index from a flat list once.
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, FolderNode[]>();
    for (const f of folders) {
      const arr = m.get(f.parentId) || [];
      arr.push(f);
      m.set(f.parentId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null | "__none__">(null);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragOver(e: React.DragEvent, target: string | null | "__none__") {
    if (!onDropSop) return;
    if (e.dataTransfer.types.includes("application/x-sop-id")) {
      e.preventDefault();
      setDropTarget(target);
    }
  }
  function handleDrop(e: React.DragEvent, target: string | null) {
    if (!onDropSop) return;
    const sopId = e.dataTransfer.getData("application/x-sop-id");
    if (sopId) {
      e.preventDefault();
      onDropSop(target, sopId);
    }
    setDropTarget(null);
  }

  function renderNode(node: FolderNode, depth: number): React.ReactNode {
    const kids = childrenOf.get(node.id) || [];
    const isOpen = !collapsed.has(node.id);
    const isSelected = selected === node.id;
    const isDropTarget = dropTarget === node.id;
    const dot = node.color || "#d4ff2e";

    const row = (
      <div
        onDragOver={(e) => handleDragOver(e, node.id)}
        onDragLeave={() => setDropTarget((p) => (p === node.id ? null : p))}
        onDrop={(e) => handleDrop(e, node.id)}
        onClick={() => onSelect(node.id)}
        className={[
          "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] cursor-pointer select-none",
          "transition-colors",
          isSelected ? "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground",
          isDropTarget ? "ring-1 ring-[#d4ff2e] ring-inset" : "",
        ].join(" ")}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
            className="flex h-4 w-4 items-center justify-center text-muted hover:text-foreground"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="h-4 w-4" />
        )}
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
        <span className="truncate flex-1">{node.name}</span>
        <span className="text-[10px] font-mono tabular-nums text-muted">
          {node.sopCountDeep}
        </span>
      </div>
    );

    return (
      <div key={node.id}>
        {canManage ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
              {onCreateChild && (
                <ContextMenuItem onClick={() => onCreateChild(node.id)}>
                  <Plus size={12} /> New sub-folder
                </ContextMenuItem>
              )}
              {onRename && (
                <ContextMenuItem onClick={() => onRename(node)}>
                  <Pencil size={12} /> Rename
                </ContextMenuItem>
              )}
              {onManageAccess && (
                <ContextMenuItem onClick={() => onManageAccess(node)}>
                  <UsersIcon size={12} /> Manage access ({node._count.access})
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              {onDelete && (
                <ContextMenuItem
                  onClick={() => onDelete(node)}
                  className="text-red-400 focus:text-red-300"
                >
                  <Trash2 size={12} /> Delete folder
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : row}

        {isOpen && kids.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf.get(null) || [];

  return (
    <div className="flex flex-col gap-0.5">
      {/* Pseudo-node: All SOPs */}
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

      {/* Pseudo-node: Unfoldered. Drop target too — drop here to "unfile" an SOP. */}
      <div
        onClick={() => onSelect("none")}
        onDragOver={(e) => handleDragOver(e, "__none__")}
        onDragLeave={() => setDropTarget((p) => (p === "__none__" ? null : p))}
        onDrop={(e) => handleDrop(e, null)}
        className={[
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 pl-[20px] text-[12.5px] cursor-pointer select-none",
          selected === "none" ? "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground",
          dropTarget === "__none__" ? "ring-1 ring-[#d4ff2e] ring-inset" : "",
        ].join(" ")}
      >
        <Inbox size={12} className="text-muted" />
        <span className="flex-1">Unfoldered</span>
        {typeof unfolderedCount === "number" && (
          <span className="text-[10px] font-mono tabular-nums text-muted">{unfolderedCount}</span>
        )}
      </div>

      <div className="my-1 border-t border-border" />

      {/* Tree */}
      {roots.length === 0 ? (
        <div className="px-2 py-3 text-[11px] text-muted">
          No folders yet.{canManage ? " Right-click to create one." : ""}
        </div>
      ) : (
        roots.map((r) => renderNode(r, 0))
      )}

      {canManage && onCreateChild && (
        <button
          type="button"
          onClick={() => onCreateChild(null)}
          className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          <Plus size={12} /> New folder
        </button>
      )}
    </div>
  );
}
