import { describe, expect, it } from "vitest";

import {
  KIND_NOUN,
  TREE_FOLDER_DEPTH,
  assembleDocPlacement,
  assembleSpaceItemPlacement,
  backFromTrail,
  correctionAllowed,
  decideWorkView,
  nestedFolderIds,
  staticDoorPlacement,
  treeFolderIds,
  type DocFacts,
  type FolderStep,
  type SpaceFact,
  type WorkGate,
} from "./placement";
import { resolveHub } from "../nav/route-hub";

const SPACE: SpaceFact = { id: "s1", slug: "design-team", name: "Design Team", icon: "palette", color: "#0073EA", access: "full" };
const step = (id: string, visible = true): FolderStep => ({ id, visible });

function doc(over: Partial<DocFacts> = {}): DocFacts {
  return {
    id: "d1",
    title: "Brief",
    space: null,
    folderPath: [],
    folderPathComplete: true,
    folder: null,
    list: null,
    task: null,
    parents: [],
    anchorDocId: null,
    ...over,
  };
}

describe("treeFolderIds", () => {
  it("walks a full viewer's path from the top while the tree would render it", () => {
    expect(treeFolderIds([step("a"), step("b")], "full")).toEqual(["a", "b"]);
    expect(treeFolderIds([step("a"), step("b", false), step("c")], "full")).toEqual(["a"]);
    expect(treeFolderIds([step("a", false), step("b")], "full")).toEqual([]);
  });

  it("stops at the depth the tree loads, which is every level Folders nest to", () => {
    expect(TREE_FOLDER_DEPTH).toBe(6);
    const seven = ["a", "b", "c", "d", "e", "f", "g"].map((id) => step(id));
    expect(treeFolderIds(seven, "full")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(treeFolderIds(seven.slice(0, 4), "full")).toEqual(["a", "b", "c", "d"]);
  });

  it("returns nothing for a path the walk could not finish", () => {
    expect(treeFolderIds([step("a"), step("b")], "full", false)).toEqual([]);
  });

  it("walks a path Space exactly like a full one: a path Folder renders at its real depth", () => {
    // The Space and "root" are path containers (visible), "g" was given.
    const path = [step("root"), step("g"), step("x")];
    expect(treeFolderIds(path, "path")).toEqual(treeFolderIds(path, "full"));
    expect(treeFolderIds(path, "path")).toEqual(["root", "g", "x"]);
    // A Folder the tree does not render stops the walk in both.
    expect(treeFolderIds([step("root"), step("sibling", false), step("x")], "path")).toEqual(["root"]);
  });

  it("gives a viewer who cannot see the Space nothing", () => {
    expect(treeFolderIds([step("a")], "none")).toEqual([]);
  });
});

describe("backFromTrail", () => {
  it("is the nearest crumb left of the object that has an href", () => {
    expect(backFromTrail([{ label: "Space", href: "/spaces/s" }, { label: "F", href: "/folders/f" }])).toEqual({ href: "/folders/f", label: "F" });
    expect(backFromTrail([{ label: "Space", href: "/spaces/s" }, { label: "No link" }])).toEqual({ href: "/spaces/s", label: "Space" });
  });

  it("falls back to Work's landing", () => {
    expect(backFromTrail([])).toEqual({ href: "/home", label: "Work" });
    expect(backFromTrail([{ label: "Space" }])).toEqual({ href: "/home", label: "Work" });
  });
});

describe("assembleDocPlacement", () => {
  it("places a Space doc at its Space-scoped address", () => {
    const p = assembleDocPlacement(doc({ space: SPACE }));
    expect(p.address).toBe("/spaces/design-team/docs/d1");
    expect(p.spaceSlug).toBe("design-team");
    expect(p.trail).toEqual([{ label: "Design Team", href: "/spaces/design-team", tile: { icon: "palette", color: "#0073EA", name: "Design Team" } }]);
    expect(p.back).toEqual({ href: "/spaces/design-team", label: "Design Team" });
    expect(p.closeHref).toBe("/spaces/design-team");
    expect(p.pill).toEqual({ selfKey: "doc:d1", favKey: "fav:doc:d1", ancestors: ["space:s1"] });
    expect(p.reveal).toEqual({ spaceId: "s1", folderIds: [] });
    expect(resolveHub(p.address)).toBe("home");
  });

  it("names the doc's own Folder and opens the folder branch", () => {
    const p = assembleDocPlacement(doc({ space: SPACE, folder: { id: "f2", name: "Brand" }, folderPath: [step("f1"), step("f2")] }));
    expect(p.trail.map((c) => c.label)).toEqual(["Design Team", "Brand"]);
    expect(p.back).toEqual({ href: "/folders/f2", label: "Brand" });
    expect(p.pill.ancestors).toEqual(["folder:f2", "folder:f1", "space:s1"]);
    expect(p.reveal).toEqual({ spaceId: "s1", folderIds: ["f1", "f2"] });
  });

  it("names the List and the task of a task doc, and falls back to the List before the folders", () => {
    const p = assembleDocPlacement(doc({
      space: SPACE,
      folder: { id: "f1", name: "Brand" },
      folderPath: [step("f1")],
      list: { id: "l1", slug: "tasks", name: "Tasks" },
      task: { id: "i1", title: null },
    }));
    expect(p.trail.map((c) => [c.label, c.href])).toEqual([
      ["Design Team", "/spaces/design-team"],
      ["Brand", "/folders/f1"],
      ["Tasks", "/boards/tasks"],
      ["Untitled task", "/item/i1"],
    ]);
    expect(p.back.href).toBe("/item/i1");
    expect(p.pill.ancestors).toEqual(["list:l1", "folder:f1", "space:s1"]);
  });

  it("places a sub-page by its anchored parent, with readable parents root first", () => {
    const p = assembleDocPlacement(doc({
      space: SPACE,
      parents: [{ id: "p2", title: "Chapter" }, { id: "p1", title: null }],
      anchorDocId: "p1",
    }));
    expect(p.address).toBe("/spaces/design-team/docs/d1");
    expect(p.trail.map((c) => [c.label, c.href])).toEqual([
      ["Design Team", "/spaces/design-team"],
      ["Untitled doc", "/spaces/design-team/docs/p1"],
      ["Chapter", "/spaces/design-team/docs/p2"],
    ]);
    expect(p.back).toEqual({ href: "/spaces/design-team/docs/p2", label: "Chapter" });
    expect(p.pill.ancestors).toEqual(["doc:p1", "space:s1"]);
  });

  it("puts a loose doc at the door, names nothing and opens nothing", () => {
    const p = assembleDocPlacement(doc());
    expect(p.address).toBe("/work/docs/d1");
    expect(p.spaceSlug).toBeNull();
    expect(p.trail).toEqual([]);
    expect(p.back).toEqual({ href: "/home", label: "Work" });
    expect(p.pill).toEqual({ selfKey: "doc:d1", favKey: "fav:doc:d1", ancestors: [] });
    expect(p.reveal).toBeNull();
    expect(resolveHub(p.address)).toBe("home");
  });

  it("keeps a loose sub-page's readable parents at their door addresses", () => {
    const p = assembleDocPlacement(doc({ parents: [{ id: "p1", title: "Top" }] }));
    expect(p.trail).toEqual([{ label: "Top", href: "/work/docs/p1" }]);
  });

  it("links a path Space's crumb to its path view, and Back lands on the given Folder", () => {
    const path: SpaceFact = { ...SPACE, access: "path" };
    const p = assembleDocPlacement(doc({
      space: path,
      folder: { id: "g", name: "Granted" },
      // "root" is a path container on the way to "g": the tree renders both.
      folderPath: [step("root"), step("g")],
    }));
    expect(p.trail[0]).toEqual({ label: "Design Team", href: "/spaces/design-team", tile: { icon: "palette", color: "#0073EA", name: "Design Team" } });
    expect(p.address).toBe("/spaces/design-team/docs/d1");
    expect(p.back).toEqual({ href: "/folders/g", label: "Granted" });
    expect(p.closeHref).toBe("/folders/g");
    expect(p.reveal).toEqual({ spaceId: "s1", folderIds: ["root", "g"] });
    expect(p.pill.ancestors).toEqual(["folder:g", "folder:root", "space:s1"]);
  });

  it("names a Folder only when the loader proved it readable or a path, and then links it", () => {
    const named = assembleDocPlacement(doc({ space: SPACE, folder: { id: "f1", name: "Brand" }, folderPath: [step("f1")] }));
    expect(named.trail[1]).toEqual({ label: "Brand", href: "/folders/f1" });
    // A Folder the viewer neither opens nor passes through never reaches the
    // assembler: the crumb stops at the Space.
    const unnamed = assembleDocPlacement(doc({ space: SPACE, folder: null, folderPath: [step("f1", false)] }));
    expect(unnamed.trail.map((c) => c.label)).toEqual(["Design Team"]);
    expect(unnamed.back).toEqual({ href: "/spaces/design-team", label: "Design Team" });
    expect(unnamed.reveal).toEqual({ spaceId: "s1", folderIds: [] });
  });

  it("names a List and a task only when they are readable, never a task without its List", () => {
    const p = assembleDocPlacement(doc({ space: SPACE, folder: { id: "f1", name: "Brand" }, folderPath: [step("f1")], list: null, task: null }));
    expect(p.trail.map((c) => c.label)).toEqual(["Design Team", "Brand"]);
    expect(p.pill.ancestors).toEqual(["folder:f1", "space:s1"]);
  });

  it("names a sub-page's parent pages only while they stay readable, nearest first", () => {
    // The loader walked d1 > p2 (readable) > p1 (not readable) > top (anchored):
    // p2 alone is named, and the pill does not fall back to the anchor page.
    const p = assembleDocPlacement(doc({ space: SPACE, parents: [{ id: "p2", title: "Chapter" }], anchorDocId: null }));
    expect(p.trail.map((c) => [c.label, c.href])).toEqual([
      ["Design Team", "/spaces/design-team"],
      ["Chapter", "/spaces/design-team/docs/p2"],
    ]);
    expect(p.pill.ancestors).toEqual(["space:s1"]);
  });

  it("never sends a folder id the viewer's tree would not render", () => {
    const p = assembleDocPlacement(doc({
      space: SPACE,
      folder: { id: "f3", name: "Deep" },
      folderPath: [step("f1"), step("hidden", false), step("f3")],
    }));
    expect(p.reveal?.folderIds).toEqual(["f1"]);
    expect(p.pill.ancestors).not.toContain("folder:hidden");
    expect(p.pill.ancestors).not.toContain("folder:f3");
  });

  it("encodes every href it builds", () => {
    const p = assembleDocPlacement(doc({ id: "a b", space: { ...SPACE, slug: "x y" }, folder: { id: "f 1", name: "F" }, folderPath: [step("f 1")] }));
    expect(p.address).toBe("/spaces/x%20y/docs/a%20b");
    expect(p.trail.map((c) => c.href)).toEqual(["/spaces/x%20y", "/folders/f%201"]);
  });
});

describe("assembleSpaceItemPlacement", () => {
  it("places a Space table or canvas under its Space only", () => {
    const t = assembleSpaceItemPlacement("table", { id: "t1", title: "Budget", space: SPACE });
    expect(t.address).toBe("/spaces/design-team/tables/t1");
    expect(t.trail.map((c) => c.label)).toEqual(["Design Team"]);
    expect(t.pill).toEqual({ selfKey: "table:t1", favKey: "fav:table:t1", ancestors: ["space:s1"] });
    expect(t.reveal).toEqual({ spaceId: "s1", folderIds: [] });
    const c = assembleSpaceItemPlacement("canvas", { id: "c1", title: null, space: SPACE });
    expect(c.address).toBe("/spaces/design-team/canvas/c1");
    expect(c.pill.selfKey).toBe("canvas:c1");
  });

  it("puts an unscoped table at the door", () => {
    const t = assembleSpaceItemPlacement("table", { id: "t1", title: "Budget", space: null });
    expect(t.address).toBe("/work/tables/t1");
    expect(t.trail).toEqual([]);
    expect(t.back).toEqual({ href: "/home", label: "Work" });
    expect(t.reveal).toBeNull();
  });

  it("names a canvas's Folder, opens its branch and lets its row pill fall back through it", () => {
    const folder = { id: "f2", name: "FW Folder", path: [step("f1"), step("f2")], complete: true };
    const c = assembleSpaceItemPlacement("canvas", { id: "c1", title: "Board", space: SPACE, folder });
    expect(c.address).toBe("/spaces/design-team/canvas/c1");
    expect(c.trail.map((x) => x.label)).toEqual(["Design Team", "FW Folder"]);
    expect(c.trail[1].href).toBe("/folders/f2");
    expect(c.back).toEqual({ href: "/folders/f2", label: "FW Folder" });
    expect(c.closeHref).toBe("/folders/f2");
    expect(c.reveal).toEqual({ spaceId: "s1", folderIds: ["f1", "f2"] });
    expect(c.pill.ancestors).toEqual(["folder:f2", "folder:f1", "space:s1"]);
  });

  it("leaves a canvas at the Space level wherever the tree does not render its Folder", () => {
    const at = (folder: Parameters<typeof nestedFolderIds>[0]) =>
      assembleSpaceItemPlacement("canvas", { id: "c1", title: "Board", space: SPACE, folder });
    const flat = (p: ReturnType<typeof at>) => {
      expect(p.trail.map((x) => x.label)).toEqual(["Design Team"]);
      expect(p.back).toEqual({ href: "/spaces/design-team", label: "Design Team" });
      expect(p.reveal).toEqual({ spaceId: "s1", folderIds: [] });
      expect(p.pill.ancestors).toEqual(["space:s1"]);
    };
    // A private Folder the viewer's tree prunes, itself or above it.
    flat(at({ id: "f2", name: "Secret", path: [step("f1"), step("f2", false)], complete: true }));
    flat(at({ id: "f2", name: "Under secret", path: [step("f1", false), step("f2")], complete: true }));
    // Deeper than the tree loads.
    flat(at({ id: "f7", name: "Deep", path: ["f1", "f2", "f3", "f4", "f5", "f6", "f7"].map((id) => step(id)), complete: true }));
    // An ancestor walk that never reached the top.
    flat(at({ id: "f2", name: "Cut", path: [step("f2")], complete: false }));
    // No Folder, or a stale one the loader could not place in this Space.
    flat(at(null));
    flat(at(undefined));
  });

  it("nests a canvas given inside a PRIVATE Folder under that Folder, both named as paths", () => {
    const path: SpaceFact = { ...SPACE, access: "path" };
    const folder = { id: "pf", name: "Private", path: [step("pf")], complete: true };
    const c = assembleSpaceItemPlacement("canvas", { id: "c1", title: "Board", space: path, folder });
    expect(c.address).toBe("/spaces/design-team/canvas/c1");
    expect(c.trail.map((x) => [x.label, x.href])).toEqual([
      ["Design Team", "/spaces/design-team"],
      ["Private", "/folders/pf"],
    ]);
    expect(c.reveal).toEqual({ spaceId: "s1", folderIds: ["pf"] });
    expect(c.pill.ancestors).toEqual(["folder:pf", "space:s1"]);
  });

  it("never names a Folder for a canvas with no Space in Work", () => {
    const folder = { id: "f1", name: "F", path: [step("f1")], complete: true };
    const c = assembleSpaceItemPlacement("canvas", { id: "c1", title: "Board", space: null, folder });
    expect(c.trail).toEqual([]);
    expect(c.reveal).toBeNull();
    expect(c.address).toBe("/work/canvas/c1");
  });
});

describe("nestedFolderIds", () => {
  it("returns the whole rendered branch only when it ends at the item's own Folder", () => {
    expect(nestedFolderIds({ id: "f3", name: "x", path: [step("f1"), step("f2"), step("f3")], complete: true })).toEqual(["f1", "f2", "f3"]);
    expect(nestedFolderIds({ id: "fX", name: "x", path: [step("f1")], complete: true })).toEqual([]);
    expect(nestedFolderIds({ id: "f1", name: "x", path: [], complete: true })).toEqual([]);
  });
});

describe("staticDoorPlacement", () => {
  it("opens an SOP or a form at the door with nothing named", () => {
    const s = staticDoorPlacement("sop", "s1");
    expect(s.address).toBe("/work/sops/s1");
    expect(s.title).toBeNull();
    expect(s.trail).toEqual([]);
    expect(s.back).toEqual({ href: "/home", label: "Work" });
    expect(s.pill).toEqual({ selfKey: "sop:s1", favKey: "fav:sop:s1", ancestors: [] });
    expect(staticDoorPlacement("form", "f1").address).toBe("/work/forms/f1");
  });

  it("has a noun for every kind", () => {
    expect(Object.keys(KIND_NOUN).sort()).toEqual(["canvas", "doc", "form", "sop", "table"]);
  });
});

describe("decideWorkView", () => {
  const placed = assembleDocPlacement(doc({ space: SPACE }));
  const ok: WorkGate = { state: "ok", placement: placed };

  it("renders the editor when the object is at the address requested", () => {
    expect(decideWorkView("/spaces/design-team/docs/d1", ok, null)).toEqual({ view: "editor", placement: placed });
    expect(decideWorkView("/spaces/design-team/docs/d1/", ok, null).view).toBe("editor");
  });

  it("corrects to the real address before any editor mounts", () => {
    expect(decideWorkView("/work/docs/d1", ok, null)).toEqual({ view: "replace", address: placed.address, placement: placed });
    expect(decideWorkView("/spaces/other-space/docs/d1", ok, null).view).toBe("replace");
  });

  it("maps the other gate states on a first render", () => {
    expect(decideWorkView("/work/docs/d1", { state: "missing" }, null)).toEqual({ view: "missing" });
    expect(decideWorkView("/work/docs/d1", { state: "error" }, null)).toEqual({ view: "error" });
    expect(decideWorkView("/work/docs/d1", { state: "signedOut" }, null)).toEqual({ view: "nothing" });
  });

  it("keeps a shown editor mounted through any refresh, re-placing it on ok", () => {
    const moved = assembleDocPlacement(doc({ space: { ...SPACE, id: "s2", slug: "ops", name: "Ops" } }));
    expect(decideWorkView("/spaces/design-team/docs/d1", { state: "ok", placement: moved }, placed)).toEqual({ view: "editor", placement: moved });
    for (const state of ["missing", "error", "signedOut"] as const) {
      expect(decideWorkView("/spaces/design-team/docs/d1", { state }, placed)).toEqual({ view: "editor", placement: placed });
    }
  });
});

describe("correctionAllowed", () => {
  it("allows the first correction and refuses a second disagreement at the corrected address", () => {
    expect(correctionAllowed(null, "doc:d1", "/work/docs/d1")).toBe(true);
    const last = { objectKey: "doc:d1", to: "/spaces/design-team/docs/d1" };
    expect(correctionAllowed(last, "doc:d1", "/spaces/design-team/docs/d1")).toBe(false);
    expect(correctionAllowed(last, "doc:d1", "/work/docs/d1")).toBe(true);
    expect(correctionAllowed(last, "doc:d2", "/spaces/design-team/docs/d1")).toBe(true);
  });
});
