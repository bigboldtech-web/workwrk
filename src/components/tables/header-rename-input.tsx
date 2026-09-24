"use client";

// The column header's inline name input (spec-tables-forms section 2, "Naming
// a column"): opened by a double click on the header, Enter or F2 on a focused
// header, or the column menu's Rename column. 32px, autoselected, commits on
// Enter and on blur, reverts on Esc.
//
// It renders INSIDE the grid div, where every keystroke would otherwise bubble
// to the grid's shortcuts. Backspace reaching the grid's clear-cells path was
// the Phase 1 data-loss defect, so this input stops propagation for EVERY key,
// pointer and clipboard event (lib/sheet-grid-keys.ts renameInputKey, pinned
// by the golden test), and the grid separately ignores keys typed into any
// editable element.

import { useRef, useState } from "react";
import { renameInputKey } from "@/lib/sheet-grid-keys";

export function HeaderRenameInput({
  initial, placeholder, onCommit, onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Enter and Escape settle the edit before the blur that follows them, so
  // the blur must not commit a second time (or commit after a revert).
  const settled = useRef(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      autoFocus
      aria-label="Column name"
      placeholder={placeholder}
      value={value}
      maxLength={120}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        const r = renameInputKey(e.nativeEvent);
        if (r.stopPropagation) e.stopPropagation();
        if (r.preventDefault) e.preventDefault();
        if (r.action === "commit") { settled.current = true; onCommit(value); }
        else if (r.action === "revert") { settled.current = true; onCancel(); }
      }}
      onBlur={() => { if (!settled.current) { settled.current = true; onCommit(value); } }}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onCopy={stop}
      onCut={stop}
      onPaste={stop}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="h-7 w-full min-w-0 rounded border border-brand bg-raised px-1.5 text-sm text-ink outline-none"
    />
  );
}
