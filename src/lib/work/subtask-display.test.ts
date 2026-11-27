import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  cardSubtasksOpen,
  forgetSubtaskDisplays,
  rememberSubtaskDisplay,
  subtaskDisplayFor,
  subtaskDisplayPatch,
} from "./subtask-display";

// Founder report 2026-11-27: "sub task not visible on top of board".

afterEach(() => forgetSubtaskDisplays());

const prefsWith = (viewId: string, subtasks: unknown) => ({ home: { work: { viewOverrides: { [viewId]: { subtasks } } } } });

describe("each person's Subtasks choice on a Board view", () => {
  it("is collapsed until they pick", () => {
    expect(subtaskDisplayFor(undefined, "v1")).toBe("collapsed");
    expect(subtaskDisplayFor({ home: {} }, "v1")).toBe("collapsed");
  });

  it("is read from their own override of the view", () => {
    expect(subtaskDisplayFor(prefsWith("v1", "expanded"), "v1")).toBe("expanded");
    expect(subtaskDisplayFor(prefsWith("v1", "separate"), "v2")).toBe("collapsed");
  });

  it("ignores a stored value it does not know", () => {
    expect(subtaskDisplayFor(prefsWith("v1", "sideways"), "v1")).toBe("collapsed");
  });

  it("what this tab saved wins over the page's first read", () => {
    rememberSubtaskDisplay("v1", "separate");
    expect(subtaskDisplayFor(prefsWith("v1", "expanded"), "v1")).toBe("separate");
  });

  it("a view with no id has no saved choice", () => {
    expect(subtaskDisplayFor(prefsWith("v1", "expanded"), null)).toBe("collapsed");
  });

  it("saves beside the person's own filter, touching nothing else", () => {
    expect(subtaskDisplayPatch("v1", "expanded")).toEqual({ home: { work: { viewOverrides: { v1: { subtasks: "expanded" } } } } });
  });
});

describe("which cards show their subtasks in place", () => {
  it("collapsed: only the cards whose count was clicked", () => {
    expect(cardSubtasksOpen("collapsed", new Set(), "a")).toBe(false);
    expect(cardSubtasksOpen("collapsed", new Set(["a"]), "a")).toBe(true);
  });

  it("expanded: every card but the ones closed by a click", () => {
    expect(cardSubtasksOpen("expanded", new Set(), "a")).toBe(true);
    expect(cardSubtasksOpen("expanded", new Set(["a"]), "a")).toBe(false);
  });

  it("separate: the subtasks are cards already, so only a clicked count opens a list", () => {
    expect(cardSubtasksOpen("separate", new Set(), "a")).toBe(false);
    expect(cardSubtasksOpen("separate", new Set(["a"]), "a")).toBe(true);
  });
});

describe("the Board uses it", () => {
  const canvas = readFileSync("src/components/board-view/board-canvas.tsx", "utf8");
  const kanban = readFileSync("src/components/board-view/board-kanban-view.tsx", "utf8");
  const table = readFileSync("src/components/board-view/board-table-view.tsx", "utf8");

  it("offers the Subtasks control at the top of the Board", () => {
    expect(canvas).toMatch(/viewType === "KANBAN" \? <SubtaskModeMenu value=\{subtaskDisplay\} onChange=\{setSubtaskDisplay\} \/> : null/);
    expect(canvas).toMatch(/subtaskDisplay=\{subtaskDisplay\}/);
  });

  it("re-reads the choice when the view changes", () => {
    expect(canvas).toMatch(/setSubtaskDisplayState\(subtaskDisplayFor\(bootPrefs, viewId\)\);/);
  });

  it("the card's count opens its list, and a subtask in it opens that subtask", () => {
    expect(kanban).toMatch(/onClick=\{\(e\) => \{ stop\(e\); onToggleSubtasks\?\.\(\); \}\}/);
    expect(kanban).toMatch(/onClick=\{\(e\) => \{ stop\(e\); onOpenSubtask\(sub\.id\); \}\}/);
  });

  it("a drop is placed only among the cards of the plain board", () => {
    expect(kanban).toMatch(/const arranged = separateOnly \? cards\.filter\(\(c\) => !separateOnly\.has\(c\.id\)\) : cards;/);
  });

  it("the List offers only the modes it can draw (its Separate did nothing)", () => {
    expect(table).toMatch(/modes=\{\["collapsed", "expanded"\]\}/);
  });
});
