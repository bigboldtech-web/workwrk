"use client";

// The sheet's chords in the "?" overlay (spec-tables-forms section 2, the
// Tables section of the shortcuts overlay). Every chord here is run by the
// sheet itself, by the grid kernel's keydown (components/tables/sheet-grid)
// or by the sheet page's own window listeners, so each is registered with
// `ownedByPage`: listed under "On this page" while a table is open, and never
// dispatched a second time by the shell listener. Registered only while the
// grid is mounted, so the overlay never names a chord that is not working.
//
// Keep this list to chords that exist. A chord added to the grid gets a row
// here; a chord removed from the grid loses its row.

import { useEffect } from "react";
import { shortcuts } from "@/lib/shortcuts";

export const SHEET_SHORTCUTS: ReadonlyArray<{ id: string; keys: string; label: string }> = [
  { id: "sheet.copy", keys: "mod+c", label: "Copy" },
  { id: "sheet.cut", keys: "mod+x", label: "Cut" },
  { id: "sheet.paste", keys: "mod+v", label: "Paste" },
  { id: "sheet.undo", keys: "mod+z", label: "Undo" },
  { id: "sheet.redo", keys: "mod+shift+z", label: "Redo" },
  { id: "sheet.select-all", keys: "mod+a", label: "Select all cells" },
  { id: "sheet.fill-down", keys: "mod+d", label: "Fill down" },
  { id: "sheet.fill-right", keys: "mod+r", label: "Fill right" },
  { id: "sheet.bold", keys: "mod+b", label: "Bold" },
  { id: "sheet.italic", keys: "mod+i", label: "Italic" },
  { id: "sheet.underline", keys: "mod+u", label: "Underline" },
  { id: "sheet.today", keys: "mod+;", label: "Insert today's date" },
  { id: "sheet.now", keys: "mod+shift+;", label: "Insert the current time" },
  { id: "sheet.find", keys: "mod+f", label: "Find in this table" },
  { id: "sheet.replace", keys: "mod+h", label: "Find and replace" },
  { id: "sheet.full-screen", keys: "mod+shift+f", label: "Full screen" },
  { id: "sheet.open-row", keys: "mod+enter", label: "Open the row" },
  { id: "sheet.row-menu", keys: "shift+f10", label: "Row menu" },
  { id: "sheet.row-menu-alt", keys: "alt+arrowdown", label: "Row menu (on a cell) or column menu (on a header)" },
];

const noop = () => {};

export function useSheetShortcutList(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const offs = SHEET_SHORTCUTS.map((d) =>
      shortcuts.register({ ...d, scope: "page", group: "Table", ownedByPage: true, run: noop }),
    );
    return () => { for (const off of offs) off(); };
  }, [enabled]);
}
