"use client";

// FolderTree (spec-docs-knowledge section 3): the drive folder tree as 36px
// rows with a 20px folder glyph, children indented 20px per level, an
// expand chevron on rows with children and a file count at the right. Used
// inside MoveFileDialog (and offered to the Docs sidebar's Files row, which
// renders the same shape through SidebarRow today).
//
// Controlled: the caller owns the folder list, the selection and, when it
// wants them remembered, the expanded ids. With `expanded` omitted the tree
// keeps its own expansion state.

import { useMemo, useState } from "react";
import { ChevronRight, Folder, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FolderTreeRow {
  id: string;
  name: string;
  parentId: string | null;
  _count?: { files?: number; children?: number };
}

export interface FolderTreeProps {
  folders: FolderTreeRow[];
  /** `null` = the drive root. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Ids of expanded folders (controlled), else internal. */
  expanded?: string[];
  onToggle?: (id: string) => void;
  /** The root row's label; omit to hide the root row. */
  rootLabel?: string;
  /** Folders that cannot be chosen (a folder being moved, and its subtree). */
  disabledIds?: ReadonlySet<string>;
  className?: string;
}

export function FolderTree({ folders, selectedId, onSelect, expanded, onToggle, rootLabel = "Files", disabledIds, className }: FolderTreeProps) {
  const [internal, setInternal] = useState<string[]>([]);
  const open = expanded ?? internal;
  const toggle = (id: string) => {
    if (onToggle) onToggle(id);
    else setInternal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FolderTreeRow[]>();
    for (const f of folders) {
      const arr = map.get(f.parentId) ?? [];
      arr.push(f);
      map.set(f.parentId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  // The ancestors of the selected folder are open so the selection is visible.
  const autoOpen = useMemo(() => {
    const set = new Set<string>();
    const byId = new Map(folders.map((f) => [f.id, f]));
    let cur = selectedId ? byId.get(selectedId)?.parentId ?? null : null;
    while (cur && !set.has(cur)) { set.add(cur); cur = byId.get(cur)?.parentId ?? null; }
    return set;
  }, [folders, selectedId]);

  const render = (parentId: string | null, depth: number, seen: Set<string>): React.ReactNode[] =>
    (childrenOf.get(parentId) ?? []).flatMap((f) => {
      if (seen.has(f.id) || depth > 8) return [];
      const next = new Set(seen).add(f.id);
      const kids = childrenOf.get(f.id) ?? [];
      const isOpen = open.includes(f.id) || autoOpen.has(f.id);
      const disabled = disabledIds?.has(f.id) ?? false;
      const row = (
        <li key={f.id}>
          <div
            role="treeitem"
            aria-selected={selectedId === f.id}
            aria-expanded={kids.length > 0 ? isOpen : undefined}
            aria-disabled={disabled || undefined}
            className={cn(
              "os-chrome flex h-9 items-center gap-2 rounded-md pe-2 text-base",
              selectedId === f.id ? "bg-active font-medium text-ink" : "text-ink hover:bg-hover",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            )}
            style={{ paddingInlineStart: 8 + depth * 20 }}
            onClick={() => { if (!disabled) onSelect(f.id); }}
          >
            {kids.length > 0 ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); toggle(f.id); }} aria-label={isOpen ? `Collapse ${f.name}` : `Expand ${f.name}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-active hover:text-ink">
                <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-90" : "rtl:rotate-180")} strokeWidth={1.5} aria-hidden />
              </button>
            ) : <span className="h-6 w-6 shrink-0" aria-hidden />}
            <Folder className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {typeof f._count?.files === "number" && f._count.files > 0 ? <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{f._count.files}</span> : null}
          </div>
        </li>
      );
      return isOpen && kids.length > 0 ? [row, ...render(f.id, depth + 1, next)] : [row];
    });

  return (
    <ul role="tree" className={cn("flex flex-col gap-0.5", className)}>
      {rootLabel ? (
        <li>
          <div
            role="treeitem"
            aria-selected={selectedId === null}
            className={cn("os-chrome flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-base", selectedId === null ? "bg-active font-medium text-ink" : "text-ink hover:bg-hover")}
            onClick={() => onSelect(null)}
          >
            <span className="h-6 w-6 shrink-0" aria-hidden />
            <HardDrive className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{rootLabel}</span>
          </div>
        </li>
      ) : null}
      {render(null, rootLabel ? 1 : 0, new Set())}
    </ul>
  );
}
