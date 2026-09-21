import { describe, it, expect } from "vitest";
import {
  DOCS_COLUMNS,
  DOCS_COLUMN_DEFAULTS,
  CANVAS_COLUMN_DEFAULTS,
  FILES_COLUMN_DEFAULTS,
  readDocsColumns,
  readDocsOutline,
  readCanvasViewType,
  readCanvasColumns,
  readFilesViewType,
  readFilesColumns,
  readNotetakerLastList,
  readSopDetailsCollapsed,
  readDocsTreeOpen,
  readDocsFoldersOpen,
  readDocsFilesOpen,
  isSectionCollapsed,
  toggleSectionCollapsed,
  toggleExpanded,
} from "./docs-prefs";

describe("Docs hub preference readers default PER FIELD", () => {
  // The reason this file exists: getEffectivePreferences merges `home` with a
  // shallow spread, so a stored namespace that carries only one of its keys
  // must still read correctly for the others.
  it("fills every column default when the namespace is absent", () => {
    expect(readDocsColumns(undefined)).toEqual(DOCS_COLUMN_DEFAULTS);
    expect(readDocsColumns({})).toEqual(DOCS_COLUMN_DEFAULTS);
    expect(readCanvasColumns({})).toEqual(CANVAS_COLUMN_DEFAULTS);
    expect(readFilesColumns({})).toEqual(FILES_COLUMN_DEFAULTS);
  });

  it("fills the OTHER columns when the stored map carries only one", () => {
    const cols = readDocsColumns({ docs: { columns: { viewed: false } } });
    expect(cols.viewed).toBe(false);
    expect(cols.location).toBe(true);
    expect(cols.updated).toBe(true);
    expect(cols.owner).toBe(true);
  });

  it("keeps outline at its default when only columns were stored", () => {
    expect(readDocsOutline({ docs: { columns: { owner: false } } })).toBe(false);
    expect(readDocsOutline({ docs: { outline: true } })).toBe(true);
  });

  it("drops a stored column key the defaults no longer name", () => {
    // A renamed or removed column must not survive in the returned shape, or
    // a renderer that loops the keys draws a column with no data behind it.
    const cols = readDocsColumns({ docs: { columns: { contributors: true } } });
    expect(Object.keys(cols).sort()).toEqual([...DOCS_COLUMNS].sort());
  });

  it("ignores a non-boolean stored column value", () => {
    expect(readDocsColumns({ docs: { columns: { owner: "yes" } } }).owner).toBe(true);
  });
});

describe("view type readers", () => {
  it("default to the grid on Canvases and the list on Files", () => {
    expect(readCanvasViewType({})).toBe("grid");
    expect(readFilesViewType({})).toBe("list");
  });

  it("read a stored value back", () => {
    expect(readCanvasViewType({ canvas: { viewType: "list" } })).toBe("list");
    expect(readFilesViewType({ files: { viewType: "list" } })).toBe("list");
  });

  it("fall back on a value the enum does not carry", () => {
    expect(readCanvasViewType({ canvas: { viewType: "board" } })).toBe("grid");
  });
});

describe("single-value readers", () => {
  it("readNotetakerLastList answers null until a note has been saved", () => {
    expect(readNotetakerLastList({})).toBeNull();
    expect(readNotetakerLastList({ notetaker: {} })).toBeNull();
    expect(readNotetakerLastList({ notetaker: { lastListId: null } })).toBeNull();
    expect(readNotetakerLastList({ notetaker: { lastListId: "" } })).toBeNull();
    expect(readNotetakerLastList({ notetaker: { lastListId: "list_1" } })).toBe("list_1");
  });

  it("readSopDetailsCollapsed defaults to expanded", () => {
    expect(readSopDetailsCollapsed({})).toBe(false);
    expect(readSopDetailsCollapsed({ ui: {} })).toBe(false);
    expect(readSopDetailsCollapsed({ ui: { sopDetailsCollapsed: true } })).toBe(true);
  });

  it("readSopDetailsCollapsed does not disturb the other home.ui keys it shares a namespace with", () => {
    expect(readSopDetailsCollapsed({ ui: { showUpcoming: true } })).toBe(false);
  });
});

describe("sidebar tree expansion", () => {
  it("reads an empty list when nothing is stored", () => {
    expect(readDocsTreeOpen(undefined)).toEqual([]);
    expect(readDocsFoldersOpen({})).toEqual([]);
  });

  it("drops non-string and empty entries rather than rendering a blank row", () => {
    expect(readDocsTreeOpen({ docsTreeOpen: ["a", "", 3, null, "b"] })).toEqual(["a", "b"]);
  });

  it("toggleExpanded appends on open and removes on close, preserving order", () => {
    expect(toggleExpanded([], "a")).toEqual(["a"]);
    expect(toggleExpanded(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleExpanded(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("toggleExpanded never mutates the list it was given", () => {
    const list = ["a"];
    toggleExpanded(list, "b");
    expect(list).toEqual(["a"]);
  });
});

describe("Files row expansion survives a reload", () => {
  it("is closed until the viewer opens it", () => {
    expect(readDocsFilesOpen(undefined)).toBe(false);
    expect(readDocsFilesOpen({})).toBe(false);
    expect(readDocsFilesOpen({ docsFilesOpen: false })).toBe(false);
  });

  it("reads the stored value", () => {
    expect(readDocsFilesOpen({ docsFilesOpen: true })).toBe(true);
  });

  it("ignores a stored value of the wrong type rather than opening at random", () => {
    expect(readDocsFilesOpen({ docsFilesOpen: "yes" })).toBe(false);
    expect(readDocsFilesOpen({ docsFilesOpen: 1 })).toBe(false);
  });
});

describe("section collapse is a preference, keyed {hub}.{section}", () => {
  it("a section nobody has touched is expanded", () => {
    expect(isSectionCollapsed(undefined, "docs.docs")).toBe(false);
    expect(isSectionCollapsed({ collapsedSections: [] }, "docs.docs")).toBe(false);
  });

  it("present in the list means collapsed", () => {
    expect(isSectionCollapsed({ collapsedSections: ["docs.docs"] }, "docs.docs")).toBe(true);
    expect(isSectionCollapsed({ collapsedSections: ["ai.chats"] }, "docs.docs")).toBe(false);
  });

  it("toggling adds then removes, and leaves other hubs' keys alone", () => {
    expect(toggleSectionCollapsed({ collapsedSections: ["ai.chats"] }, "docs.docs")).toEqual(["ai.chats", "docs.docs"]);
    expect(toggleSectionCollapsed({ collapsedSections: ["ai.chats", "docs.docs"] }, "docs.docs")).toEqual(["ai.chats"]);
  });
});
