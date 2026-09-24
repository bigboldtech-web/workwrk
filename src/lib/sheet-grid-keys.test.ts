import { describe, expect, it } from "vitest";
import { EDITABLE_SEL, headerKeyAction, headerStopsPropagation, isContextMenuKey, isEditableKeyTarget, isRowMenuKey, renameInputKey } from "./sheet-grid-keys";

/** A stand-in for an element: `closest` answers for the selectors it matches. */
function el(tag: "input" | "textarea" | "div" | "span-in-input"): { closest: (s: string) => unknown } {
  return {
    closest: (s: string) => {
      if (s !== EDITABLE_SEL) return null;
      if (tag === "div") return null;
      return { tagName: tag === "span-in-input" ? "INPUT" : tag.toUpperCase() };
    },
  };
}

/**
 * The grid's clear-cells decision, reduced to what the kernel's onKeyDown does
 * before it reaches its Delete/Backspace case: the editable-target guard, then
 * the key. This is the exact order in sheet-grid.tsx's handler.
 */
function gridWouldClearCells(target: { closest: (s: string) => unknown }, key: string, stoppedByInput: boolean): boolean {
  if (stoppedByInput) return false;            // the event never bubbled
  if (isEditableKeyTarget(target)) return false; // the kernel's first line
  return key === "Backspace" || key === "Delete";
}

describe("GOLDEN: Backspace in the header rename input never clears cells (Phase 1 data-loss defect)", () => {
  for (const key of ["Backspace", "Delete"]) {
    it(`${key} typed into the header input stops at the input`, () => {
      const r = renameInputKey({ key });
      expect(r.stopPropagation).toBe(true);
      expect(r.action).toBe("type");
      expect(r.preventDefault).toBe(false); // the character is still deleted in the input
      expect(gridWouldClearCells(el("input"), key, r.stopPropagation)).toBe(false);
    });
    it(`${key} still cannot clear cells if an input forgets to stop propagation`, () => {
      expect(gridWouldClearCells(el("input"), key, false)).toBe(false);
      expect(gridWouldClearCells(el("span-in-input"), key, false)).toBe(false);
      expect(gridWouldClearCells(el("textarea"), key, false)).toBe(false);
    });
  }
  it("the grid body itself still clears cells, so the guard is not a no-op", () => {
    expect(gridWouldClearCells(el("div"), "Backspace", false)).toBe(true);
  });
  it("every key typed into the input stops propagation", () => {
    for (const key of ["a", "Enter", "Escape", "ArrowLeft", "Tab", "z", " ", "v"]) {
      expect(renameInputKey({ key, metaKey: key === "v" }).stopPropagation).toBe(true);
    }
  });
  it("Enter commits, Escape reverts, an IME composition is left alone", () => {
    expect(renameInputKey({ key: "Enter" }).action).toBe("commit");
    expect(renameInputKey({ key: "Escape" }).action).toBe("revert");
    expect(renameInputKey({ key: "Enter", isComposing: true }).action).toBe("type");
  });
});

describe("isEditableKeyTarget", () => {
  it("is false for nothing and for a plain element", () => {
    expect(isEditableKeyTarget(null)).toBe(false);
    expect(isEditableKeyTarget({})).toBe(false);
    expect(isEditableKeyTarget(el("div"))).toBe(false);
  });
});

describe("headerKeyAction (keyboard parity for the column menu)", () => {
  it("opens the menu on Alt+Down, the context-menu key and Shift+F10", () => {
    expect(headerKeyAction({ key: "ArrowDown", altKey: true })).toBe("menu");
    expect(headerKeyAction({ key: "ContextMenu" })).toBe("menu");
    expect(headerKeyAction({ key: "F10", shiftKey: true })).toBe("menu");
  });
  it("renames on Enter and F2, selects on Space, moves on arrows", () => {
    expect(headerKeyAction({ key: "Enter" })).toBe("rename");
    expect(headerKeyAction({ key: "F2" })).toBe("rename");
    expect(headerKeyAction({ key: " " })).toBe("select");
    expect(headerKeyAction({ key: "ArrowLeft" })).toBe("prev");
    expect(headerKeyAction({ key: "ArrowRight" })).toBe("next");
    expect(headerKeyAction({ key: "ArrowDown" })).toBe("into-grid");
  });
  it("never treats Backspace on a focused header as anything", () => {
    expect(headerKeyAction({ key: "Backspace" })).toBe("none");
    expect(headerKeyAction({ key: "Delete" })).toBe("none");
  });
});

describe("isContextMenuKey", () => {
  it("matches the context-menu key and Shift+F10 only", () => {
    expect(isContextMenuKey({ key: "ContextMenu" })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10" })).toBe(false);
  });
});

describe("headerStopsPropagation (a focused header does not swallow global shortcuts)", () => {
  it("holds back Backspace and Delete, and every key the header acts on", () => {
    expect(headerStopsPropagation({ key: "Backspace" })).toBe(true);
    expect(headerStopsPropagation({ key: "Delete" })).toBe(true);
    expect(headerStopsPropagation({ key: "Enter" })).toBe(true);
    expect(headerStopsPropagation({ key: "ArrowDown", altKey: true })).toBe(true);
  });
  it("lets Cmd+K, Cmd+Z and ? bubble to the page", () => {
    expect(headerStopsPropagation({ key: "k", metaKey: true })).toBe(false);
    expect(headerStopsPropagation({ key: "z", metaKey: true })).toBe(false);
    expect(headerStopsPropagation({ key: "?" , shiftKey: true })).toBe(false);
  });
});

describe("isRowMenuKey (a keyboard path to row actions on a Mac too)", () => {
  it("opens on Option/Alt+Down, the context-menu key and Shift+F10", () => {
    expect(isRowMenuKey({ key: "ArrowDown", altKey: true })).toBe(true);
    expect(isRowMenuKey({ key: "ContextMenu" })).toBe(true);
    expect(isRowMenuKey({ key: "F10", shiftKey: true })).toBe(true);
  });
  it("leaves plain, Shift and Cmd arrows to navigation", () => {
    expect(isRowMenuKey({ key: "ArrowDown" })).toBe(false);
    expect(isRowMenuKey({ key: "ArrowDown", shiftKey: true })).toBe(false);
    expect(isRowMenuKey({ key: "ArrowDown", metaKey: true })).toBe(false);
    expect(isRowMenuKey({ key: "ArrowDown", altKey: true, shiftKey: true })).toBe(false);
  });
});

// The suite runs without a DOM, so the golden test above proves the pure
// decisions. These pins hold the WIRING those decisions depend on, in the
// real components, so a refactor cannot quietly drop a guard: if one of these
// fails, re-read the Phase 1 data-loss note at the top of sheet-grid-keys.ts.
describe("GOLDEN wiring: the guards are where the handlers run", () => {
  const read = async (rel: string) => (await import("node:fs")).readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  it("the grid body's keydown opens with the editable-target and header guards", async () => {
    const src = await read("components/tables/sheet-grid.tsx");
    const body = src.slice(src.indexOf("const onKeyDown = (e: React.KeyboardEvent) => {"));
    const head = body.slice(0, 700);
    expect(head).toContain("if (isEditableKeyTarget(target)) return;");
    // A header target returns after undo/redo only: no cell shortcut runs.
    expect(head).toContain(`if (target?.closest?.('[role="columnheader"]')) { runUndoRedoKey(e); return; }`);
    // Both guards come before the first branch that can clear cells.
    const clear = body.indexOf('case "Backspace"');
    expect(clear === -1 || clear > head.indexOf("columnheader")).toBe(true);
  });
  it("the undo/redo helper a focused header may run never touches cells", async () => {
    const src = await read("components/tables/sheet-grid.tsx");
    const start = src.indexOf("const runUndoRedoKey = ");
    const fn = src.slice(start, src.indexOf("const onKeyDown = (e: React.KeyboardEvent) => {"));
    expect(start).toBeGreaterThan(-1);
    expect(fn).not.toContain("onClearCells");
    expect(fn).not.toContain("Backspace");
    expect(fn).toContain('k === "z"');
  });
  it("the header keydown ignores the rename input and holds back Backspace", async () => {
    const src = await read("components/tables/sheet-grid.tsx");
    const fn = src.slice(src.indexOf("const onHeaderKeyDown = "), src.indexOf("const onHeaderKeyDown = ") + 900);
    expect(fn).toContain("if (isEditableKeyTarget(e.target as HTMLElement | null)) return;");
    expect(fn).toContain("if (headerStopsPropagation(e)) e.stopPropagation();");
  });
  it("the rename input stops every key through renameInputKey", async () => {
    const src = await read("components/tables/header-rename-input.tsx");
    expect(src).toContain("const r = renameInputKey(e.nativeEvent);");
    expect(src).toContain("if (r.stopPropagation) e.stopPropagation();");
  });
});
