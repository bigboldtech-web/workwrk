"use client";

// GridRowMenu (spec-tables-forms section 3): the ONE row menu, opened by the
// gutter chevron, the context-menu key on an active cell, and right click.
//
// Order is the spec's: Open row, then insert and move, then freeze, then clear
// and delete (the label pluralises with the selection). Move row up and Move
// row down are new in Phase 5: a row move existed only as a gutter drag
// (data.md 3.10). Rows that cannot run while a sort, filter, search or stream
// is active stay in the menu, disabled, with the reason as the tooltip: the
// one place a disabled row is right, because the reason is temporary and the
// person can clear it.

import type { RefObject } from "react";
import {
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, ChevronRight, Eraser, Pin, PinOff, Trash2,
} from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { menuArrowKeys, useMenuFocus } from "./grid-header-menu";

export function GridRowMenu({
  rowId, displayIndex, rowCount, spanCount, point, anchorRef, panelRef,
  structureBlocked, blockedReason, canFreeze, frozenRows, onClose,
  onOpen, onInsert, onMove, onFreeze, onUnfreeze, onClear, onDelete,
}: {
  rowId: string;
  /** The row's display index (0-based), for "Freeze up to row N". */
  displayIndex: number;
  rowCount: number;
  /** More than one row selected and this row inside the selection. */
  spanCount: number | null;
  point: { x: number; y: number };
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  /** Insert and move need display order to BE storage order. */
  structureBlocked: boolean;
  blockedReason: string;
  canFreeze: boolean;
  frozenRows: number | undefined;
  onClose: () => void;
  onOpen: () => void;
  onInsert: (where: "above" | "below") => void;
  onMove: (dir: -1 | 1) => void;
  onFreeze: () => void;
  onUnfreeze: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const run = (fn: () => void) => () => { onClose(); fn(); };
  useMenuFocus(panelRef, `${rowId}:${point.x}:${point.y}`);
  const blockedTitle = structureBlocked ? blockedReason : undefined;

  return (
    <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={220} open placement="below" point={point}>
      <MenuList className="min-w-[220px]" aria-label={`Row ${displayIndex + 1}`} onKeyDown={menuArrowKeys}>
        <MenuItem icon={ChevronRight} label="Open row" onClick={run(onOpen)} />
        <MenuSeparator />
        <MenuItem icon={ArrowUpFromLine} label="Insert row above" disabled={structureBlocked} title={blockedTitle} onClick={run(() => onInsert("above"))} />
        <MenuItem icon={ArrowDownToLine} label="Insert row below" disabled={structureBlocked} title={blockedTitle} onClick={run(() => onInsert("below"))} />
        {displayIndex > 0 ? (
          <MenuItem icon={ArrowUp} label="Move row up" disabled={structureBlocked} title={blockedTitle} onClick={run(() => onMove(-1))} />
        ) : null}
        {displayIndex < rowCount - 1 ? (
          <MenuItem icon={ArrowDown} label="Move row down" disabled={structureBlocked} title={blockedTitle} onClick={run(() => onMove(1))} />
        ) : null}
        {canFreeze || frozenRows ? <MenuSeparator /> : null}
        {canFreeze ? <MenuItem icon={Pin} label={`Freeze up to row ${displayIndex + 1}`} onClick={run(onFreeze)} /> : null}
        {frozenRows ? <MenuItem icon={PinOff} label="Unfreeze rows" onClick={run(onUnfreeze)} /> : null}
        <MenuSeparator />
        <MenuItem icon={Eraser} label={spanCount ? `Clear ${spanCount} rows` : "Clear row"} onClick={run(onClear)} />
        <MenuItem icon={Trash2} label={spanCount ? `Delete ${spanCount} rows` : "Delete row"} destructive onClick={run(onDelete)} />
      </MenuList>
    </MorePortal>
  );
}
