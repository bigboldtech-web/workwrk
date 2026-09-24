"use client";

// GridHeaderMenu (spec-tables-forms section 3): the ONE column menu, opened by
// the header chevron, Alt+Down or the context-menu key on a focused header,
// and right click. Every row names a live handler the page owns; rows that
// cannot apply to this column are absent, never disabled.
//
// Order is the spec's (section 2 /tables/[id], "Column menu"): Rename column,
// Column type, then sort, then insert and move and width, then freeze, then
// validation, formatting, formula, relation, options, protection, then clear and
// delete. Rename, Column type, Move left, Move right and Column width are new
// in Phase 5: before them a column could not be named or typed at all (data.md
// 3.1, 3.2) and a move or a width existed only as a mouse drag (3.10).

import { useEffect, type RefObject } from "react";
import {
  ArrowDownAZ, ArrowLeftToLine, ArrowRightToLine, ArrowUpZA, Eraser, Link2, ListChecks,
  List, Lock, MoveHorizontal, MoveLeft, MoveRight, Palette, PenLine, Pin, PinOff, Shapes, Sigma, Trash2, Unlock, X,
} from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { columnTypeLabel } from "@/lib/sheet-columns";

export interface GridHeaderMenuColumn {
  id: string;
  label: string;
  type: string;
  protected?: boolean;
}

export function GridHeaderMenu({
  column, index, columnCount, letter, point, anchorRef, panelRef,
  sortActive, frozenCols, onClose,
  onRename, onType, onSort, onClearSort, onInsert, onMove, onWidth,
  onFreeze, onUnfreeze, onValidation, onConditional, onEditFormula, onConfigureRelation,
  onEditOptions, onToggleProtect, onClear, onDelete,
}: {
  column: GridHeaderMenuColumn;
  index: number;
  columnCount: number;
  letter: string;
  point: { x: number; y: number };
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  sortActive: boolean;
  frozenCols: number | undefined;
  onClose: () => void;
  onRename: () => void;
  /** Opens the type picker at the menu's point. */
  onType: () => void;
  onSort: (dir: "asc" | "desc") => void;
  onClearSort: () => void;
  onInsert: (where: "left" | "right") => void;
  onMove: (dir: -1 | 1) => void;
  onWidth: () => void;
  onFreeze: () => void;
  onUnfreeze: () => void;
  onValidation: () => void;
  onConditional: () => void;
  onEditFormula: () => void;
  onConfigureRelation: () => void;
  /** Single and Multiple select: reopens the options editor at any time. */
  onEditOptions: () => void;
  onToggleProtect: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const name = column.label.trim() || letter;
  // A freeze must leave at least one column scrolling.
  const canFreeze = index + 1 <= columnCount - 1;
  const relational = column.type === "link" || column.type === "lookup" || column.type === "rollup";
  const run = (fn: () => void) => () => { onClose(); fn(); };
  useMenuFocus(panelRef, `${column.id}:${point.x}:${point.y}`);

  const typeLabel = columnTypeLabel(column.type);

  // 300, not 240: the "Column type" row carries the type's name on its right,
  // and "Link to another table" left the row's own label only room for "Col...".
  // The shared MenuItem keeps its trailing slot shrink-0, so the squeeze always
  // lands on the label; capping the type name here (it truncates, with the full
  // name in the tooltip) keeps a future longer type from doing the same.
  return (
    <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={300} open placement="below" point={point}>
      <MenuList className="min-w-[300px]" aria-label={`Column ${name}`} onKeyDown={menuArrowKeys}>
        <MenuItem icon={PenLine} label="Rename column" shortcut="Enter" onClick={run(onRename)} />
        <MenuItem icon={Shapes} label="Column type" trailing={<span className="block max-w-[136px] truncate text-sm text-ink-2" title={typeLabel}>{typeLabel}</span>} submenu onClick={run(onType)} />
        <MenuSeparator />
        <MenuItem icon={ArrowDownAZ} label={`Sort A to Z by ${name}`} onClick={run(() => onSort("asc"))} />
        <MenuItem icon={ArrowUpZA} label={`Sort Z to A by ${name}`} onClick={run(() => onSort("desc"))} />
        {sortActive ? <MenuItem icon={X} label="Clear sort" onClick={run(onClearSort)} /> : null}
        <MenuSeparator />
        <MenuItem icon={ArrowLeftToLine} label="Insert column left" onClick={run(() => onInsert("left"))} />
        <MenuItem icon={ArrowRightToLine} label="Insert column right" onClick={run(() => onInsert("right"))} />
        {index > 0 ? <MenuItem icon={MoveLeft} label="Move column left" onClick={run(() => onMove(-1))} /> : null}
        {index < columnCount - 1 ? <MenuItem icon={MoveRight} label="Move column right" onClick={run(() => onMove(1))} /> : null}
        <MenuItem icon={MoveHorizontal} label="Column width…" onClick={run(onWidth)} />
        {canFreeze || frozenCols ? <MenuSeparator /> : null}
        {canFreeze ? <MenuItem icon={Pin} label={`Freeze up to column ${letter}`} onClick={run(onFreeze)} /> : null}
        {frozenCols ? <MenuItem icon={PinOff} label="Unfreeze columns" onClick={run(onUnfreeze)} /> : null}
        <MenuSeparator />
        <MenuItem icon={ListChecks} label="Data validation…" onClick={run(onValidation)} />
        <MenuItem icon={Palette} label="Conditional formatting…" onClick={run(onConditional)} />
        {column.type === "formula" ? <MenuItem icon={Sigma} label="Edit formula…" onClick={run(onEditFormula)} /> : null}
        {relational ? <MenuItem icon={Link2} label="Configure relation…" onClick={run(onConfigureRelation)} /> : null}
        {column.type === "select" || column.type === "multi_select" ? <MenuItem icon={List} label="Edit options…" onClick={run(onEditOptions)} /> : null}
        <MenuItem icon={column.protected ? Unlock : Lock} label={column.protected ? "Unprotect column" : "Protect column"} onClick={run(onToggleProtect)} />
        <MenuSeparator />
        <MenuItem icon={Eraser} label="Clear column" onClick={run(onClear)} />
        <MenuItem icon={Trash2} label="Delete column" destructive onClick={run(onDelete)} />
      </MenuList>
    </MorePortal>
  );
}

/** Put focus on the first row when the menu opens, so a keyboard user who
 *  opened it with Alt+Down or the context-menu key is inside it. */
export function useMenuFocus(panelRef: RefObject<HTMLDivElement | null>, openKey: string) {
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [panelRef, openKey]);
}

/** Up and Down move between rows, Home and End jump (a menu's arrow keys). */
export function menuArrowKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (items.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0
    : e.key === "End" ? items.length - 1
    : e.key === "ArrowDown" ? (at + 1) % items.length
    : (at - 1 + items.length) % items.length;
  items[next]?.focus();
}
