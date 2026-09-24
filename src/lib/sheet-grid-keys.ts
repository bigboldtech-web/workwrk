// The sheet grid's keyboard decisions that must never regress, as pure
// functions so the node test suite can hold them (vitest runs without a DOM).
//
// THE PHASE 1 DATA-LOSS DEFECT. A column header once carried a label <input>.
// Backspace typed into it bubbled to the grid's keydown handler, which read it
// as "clear the selected cells" and wiped the user's data one keystroke at a
// time. Two guards now stand between a header input and that shortcut, and the
// golden test in sheet-grid-keys.test.ts pins both:
//   1. the rename input answers every keystroke itself and stops propagation
//      (renameInputKey says so for every key, Backspace and Delete included);
//   2. the grid ignores any keystroke whose target is inside an editable
//      element (isEditableKeyTarget), so even a future input that forgets to
//      stop propagation cannot reach the clear-cells path.
//
// Pure: no imports.

/** Every caret the grid can contain: a cell editor, the header rename input. */
export const EDITABLE_SEL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** The structural minimum of an event target the guard needs. */
export interface KeyTargetLike {
  closest?: (selector: string) => unknown;
}

/** Guard 2: a keystroke typed into a field belongs to the field. */
export function isEditableKeyTarget(target: KeyTargetLike | null | undefined): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return !!target.closest(EDITABLE_SEL);
}

export interface KeyLike {
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
}

/**
 * Guard 1: what the header rename input does with a key. It ALWAYS stops
 * propagation: the grid never sees a keystroke typed into a column name.
 * Enter commits, Escape reverts, everything else is plain text editing.
 */
export function renameInputKey(e: KeyLike): { action: "commit" | "revert" | "type"; stopPropagation: true; preventDefault: boolean } {
  if (e.isComposing) return { action: "type", stopPropagation: true, preventDefault: false };
  if (e.key === "Enter") return { action: "commit", stopPropagation: true, preventDefault: true };
  if (e.key === "Escape") return { action: "revert", stopPropagation: true, preventDefault: true };
  return { action: "type", stopPropagation: true, preventDefault: false };
}

export type HeaderKeyAction =
  | "menu"      // Alt+Down, the context-menu key, Shift+F10: the column menu
  | "rename"    // Enter or F2: the inline name input
  | "select"    // Space: select the whole column
  | "prev"      // ArrowLeft: the header to the left
  | "next"      // ArrowRight: the header to the right
  | "into-grid" // ArrowDown: the first cell of the column
  | "none";

/** A focused COLUMN HEADER's keys (spec section 1, touch and keyboard parity). */
export function headerKeyAction(e: KeyLike): HeaderKeyAction {
  if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) return "menu";
  if (e.key === "ArrowDown" && e.altKey) return "menu";
  if (e.metaKey || e.ctrlKey || e.altKey) return "none";
  switch (e.key) {
    case "Enter": case "F2": return "rename";
    case " ": return "select";
    case "ArrowLeft": return "prev";
    case "ArrowRight": return "next";
    case "ArrowDown": return "into-grid";
    default: return "none";
  }
}

/**
 * Whether a key on a focused header is kept from bubbling past it. A key the
 * header acts on is its own, and Backspace and Delete are always held back
 * (the clear-cells family). Anything else bubbles on, so the page's global
 * shortcuts (Cmd+K, Cmd+\, ?) and undo still work while a header has focus;
 * the grid body separately ignores keys whose target is a header.
 */
export function headerStopsPropagation(e: KeyLike): boolean {
  if (e.key === "Backspace" || e.key === "Delete") return true;
  return headerKeyAction(e) !== "none";
}

/** The grid BODY's context-menu key: the row menu for the active row. */
export function isContextMenuKey(e: KeyLike): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && !!e.shiftKey);
}

/**
 * The row menu's keys on the active cell: the context-menu key, Shift+F10,
 * and Alt+Down (Option+Down on a Mac, whose keyboards have no context-menu key
 * and put F10 behind fn). The gutter is not a tab stop, so the active cell
 * stands for it (spec section 1, touch and keyboard parity: "Alt+Down or the
 * context-menu key when the header or gutter cell has focus").
 */
export function isRowMenuKey(e: KeyLike): boolean {
  if (isContextMenuKey(e)) return true;
  return e.key === "ArrowDown" && !!e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
}
