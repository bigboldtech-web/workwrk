import { describe, expect, it } from "vitest";
import {
  SPACE_VIEW_KEYS,
  SPACE_VIEW_LABELS,
  defaultSpaceView,
  hiddenSpaceViews,
  isSpaceViewKey,
  mergeSpaceSettings,
  orderSpaceTabs,
  readSpaceDefaultView,
  resolveSpaceView,
  spaceModulesPatch,
  spaceTabHref,
  spaceTabMenuRow,
} from "./space-default-view";

const CALENDAR_OFF = { workflow: { modules: ["PRIORITY", "TAGS"] } };
const CALENDAR_ON = { workflow: { modules: ["CALENDAR_VIEW"] } };

describe("the Space tab keys", () => {
  it("puts Bird's eye directly after Overview", () => {
    expect(SPACE_VIEW_KEYS.slice(0, 2)).toEqual(["overview", "birdseye"]);
    expect(SPACE_VIEW_LABELS.birdseye).toBe("Bird's eye");
  });

  it("knows exactly the seven tabs", () => {
    for (const k of SPACE_VIEW_KEYS) expect(isSpaceViewKey(k)).toBe(true);
    for (const bad of ["", "Overview", "kanban", null, undefined, 3, {}]) expect(isSpaceViewKey(bad)).toBe(false);
  });
});

describe("readSpaceDefaultView", () => {
  it("reads a stored tab key", () => {
    expect(readSpaceDefaultView({ defaultView: "birdseye" })).toBe("birdseye");
  });

  it("ignores anything that is not a tab, and the wizard's List view key", () => {
    expect(readSpaceDefaultView({ defaultView: "KANBAN" })).toBeNull();
    expect(readSpaceDefaultView({ workflow: { defaultViewKey: "board" } })).toBeNull();
    expect(readSpaceDefaultView(null)).toBeNull();
    expect(readSpaceDefaultView([])).toBeNull();
    expect(readSpaceDefaultView("board")).toBeNull();
  });
});

describe("hiddenSpaceViews", () => {
  it("hides Calendar only when the module list leaves it out", () => {
    expect(hiddenSpaceViews(CALENDAR_OFF)).toEqual(["calendar"]);
    expect(hiddenSpaceViews(CALENDAR_ON)).toEqual([]);
  });

  it("shows every tab on a Space with no modules list", () => {
    expect(hiddenSpaceViews({})).toEqual([]);
    expect(hiddenSpaceViews(null)).toEqual([]);
  });
});

describe("resolveSpaceView", () => {
  it("opens a requested tab, whatever is pinned", () => {
    expect(resolveSpaceView({ requested: "gantt", pinned: "birdseye", hidden: [] })).toBe("gantt");
    expect(resolveSpaceView({ requested: "overview", pinned: "birdseye", hidden: [] })).toBe("overview");
  });

  it("opens Overview for a requested tab that is switched off", () => {
    expect(resolveSpaceView({ requested: "calendar", pinned: "birdseye", hidden: ["calendar"] })).toBe("overview");
  });

  it("opens the pin with no request, or with a word that is not a tab", () => {
    expect(resolveSpaceView({ requested: undefined, pinned: "birdseye", hidden: [] })).toBe("birdseye");
    expect(resolveSpaceView({ requested: "nonsense", pinned: "board", hidden: [] })).toBe("board");
  });

  it("falls back to Overview when nothing is pinned or the pin is hidden", () => {
    expect(resolveSpaceView({ requested: undefined, pinned: null, hidden: [] })).toBe("overview");
    expect(resolveSpaceView({ requested: undefined, pinned: "calendar", hidden: ["calendar"] })).toBe("overview");
  });

  it("agrees with defaultSpaceView for every pin", () => {
    for (const pin of [null, ...SPACE_VIEW_KEYS]) {
      for (const hidden of [[], ["calendar"]] as const) {
        expect(resolveSpaceView({ requested: undefined, pinned: pin, hidden })).toBe(defaultSpaceView(pin, hidden));
      }
    }
  });
});

describe("orderSpaceTabs", () => {
  it("is the canonical order with nothing pinned", () => {
    expect(orderSpaceTabs([], null)).toEqual(["overview", "birdseye", "list", "board", "team", "calendar", "gantt"]);
  });

  it("moves a shown pin first and keeps the rest in order", () => {
    expect(orderSpaceTabs([], "board")).toEqual(["board", "overview", "birdseye", "list", "team", "calendar", "gantt"]);
  });

  it("drops hidden tabs and never promotes a hidden pin", () => {
    expect(orderSpaceTabs(["calendar"], "calendar")).toEqual(["overview", "birdseye", "list", "board", "team", "gantt"]);
  });

  it("puts first the very tab the bare URL opens, for every pin", () => {
    for (const pin of [null, ...SPACE_VIEW_KEYS]) {
      for (const hidden of [[], ["calendar"]] as const) {
        expect(orderSpaceTabs(hidden, pin)[0]).toBe(defaultSpaceView(pin, hidden));
      }
    }
  });
});

describe("spaceTabHref", () => {
  it("gives the default tab the bare URL and names every other tab", () => {
    expect(spaceTabHref("design", "overview", "overview")).toBe("/spaces/design");
    expect(spaceTabHref("design", "birdseye", "overview")).toBe("/spaces/design?view=birdseye");
  });

  it("keeps Overview reachable once another view is pinned", () => {
    expect(spaceTabHref("design", "birdseye", "birdseye")).toBe("/spaces/design");
    expect(spaceTabHref("design", "overview", "birdseye")).toBe("/spaces/design?view=overview");
  });
});

describe("spaceTabMenuRow", () => {
  it("offers nothing without the right to pin", () => {
    expect(spaceTabMenuRow({ key: "board", pinned: null, hidden: [], canPin: false })).toBe("none");
    expect(spaceTabMenuRow({ key: "board", pinned: "board", hidden: [], canPin: false })).toBe("none");
  });

  it("offers Pin on an unpinned tab and Unpin on the pinned one", () => {
    expect(spaceTabMenuRow({ key: "board", pinned: null, hidden: [], canPin: true })).toBe("pin");
    expect(spaceTabMenuRow({ key: "board", pinned: "birdseye", hidden: [], canPin: true })).toBe("pin");
    expect(spaceTabMenuRow({ key: "birdseye", pinned: "birdseye", hidden: [], canPin: true })).toBe("unpin");
  });

  it("puts the way to clear a hidden pin on Overview", () => {
    expect(spaceTabMenuRow({ key: "overview", pinned: "calendar", hidden: ["calendar"], canPin: true })).toBe("unpin-hidden");
    expect(spaceTabMenuRow({ key: "board", pinned: "calendar", hidden: ["calendar"], canPin: true })).toBe("pin");
  });
});

describe("mergeSpaceSettings", () => {
  it("keeps every stored key the patch does not name", () => {
    const stored = { bookmarks: [{ id: "b" }], workflow: { modules: ["TAGS"] }, defaultView: "board" };
    expect(mergeSpaceSettings(stored, { defaultView: "gantt" })).toEqual({
      bookmarks: [{ id: "b" }],
      workflow: { modules: ["TAGS"] },
      defaultView: "gantt",
    });
  });

  it("deletes a key set to null and skips an undefined one", () => {
    expect(mergeSpaceSettings({ defaultView: "board", a: 1 }, { defaultView: null, a: undefined })).toEqual({ a: 1 });
  });

  it("treats a stored blob that is not an object as empty", () => {
    expect(mergeSpaceSettings(null, { defaultView: "board" })).toEqual({ defaultView: "board" });
    expect(mergeSpaceSettings([1, 2], { x: 1 })).toEqual({ x: 1 });
  });

  it("never mutates what it was given", () => {
    const stored = { defaultView: "board" };
    mergeSpaceSettings(stored, { defaultView: null });
    expect(stored).toEqual({ defaultView: "board" });
  });
});

describe("spaceModulesPatch", () => {
  it("replaces only workflow.modules and keeps the rest of workflow", () => {
    const stored = { workflow: { statuses: [{ key: "A" }], modules: ["TAGS"] }, bookmarks: [] };
    expect(spaceModulesPatch(stored, ["TAGS", "PRIORITY"])).toEqual({
      workflow: { statuses: [{ key: "A" }], modules: ["TAGS", "PRIORITY"] },
    });
  });

  it("unpins Calendar when Calendar is switched off", () => {
    const patch = spaceModulesPatch({ defaultView: "calendar", workflow: { modules: ["CALENDAR_VIEW"] } }, ["TAGS"]);
    expect(patch).toEqual({ workflow: { modules: ["TAGS"] }, defaultView: null });
    expect(mergeSpaceSettings({ defaultView: "calendar" }, patch)).toEqual({ workflow: { modules: ["TAGS"] } });
  });

  it("leaves any other pin alone", () => {
    expect(spaceModulesPatch({ defaultView: "birdseye" }, ["TAGS"])).toEqual({ workflow: { modules: ["TAGS"] } });
    expect(spaceModulesPatch({ defaultView: "calendar" }, ["CALENDAR_VIEW"])).toEqual({ workflow: { modules: ["CALENDAR_VIEW"] } });
  });
});
