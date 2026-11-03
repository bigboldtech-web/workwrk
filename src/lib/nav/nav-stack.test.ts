import { describe, expect, it } from "vitest";
import { drawerStepsBack, isDrawerEntry, navPop, navPreviousIs, navPush, navReplace, type NavStack } from "./nav-stack";

const at = (stack: string[], idx: number): NavStack => ({ stack, idx });

describe("navPush", () => {
  it("appends and moves the cursor", () => {
    expect(navPush(at(["/a"], 0), "/b")).toEqual(at(["/a", "/b"], 1));
  });

  it("drops everything forward of the cursor, as the browser does", () => {
    expect(navPush(at(["/a", "/b", "/c"], 0), "/d")).toEqual(at(["/a", "/d"], 1));
  });

  it("starts an empty mirror and keeps at most `max` entries", () => {
    expect(navPush(at([], -1), "/a")).toEqual(at(["/a"], 0));
    expect(navPush(at(["/1", "/2", "/3"], 2), "/4", 3)).toEqual(at(["/2", "/3", "/4"], 2));
  });
});

describe("navReplace", () => {
  it("rewrites the current entry only", () => {
    expect(navReplace(at(["/a", "/b", "/c"], 1), "/x")).toEqual(at(["/a", "/x", "/c"], 1));
  });

  it("seeds an empty mirror, and is a no-op on the same URL", () => {
    expect(navReplace(at([], -1), "/a")).toEqual(at(["/a"], 0));
    const same = at(["/a"], 0);
    expect(navReplace(same, "/a")).toBe(same);
  });
});

describe("navPop", () => {
  it("steps back and forward onto a neighbour", () => {
    expect(navPop(at(["/a", "/b", "/c"], 1), "/a")).toEqual(at(["/a", "/b", "/c"], 0));
    expect(navPop(at(["/a", "/b", "/c"], 1), "/c")).toEqual(at(["/a", "/b", "/c"], 2));
  });

  it("stays put when it is already there (the page stepped the mirror itself)", () => {
    const cur = at(["/a", "/b"], 0);
    expect(navPop(cur, "/a")).toBe(cur);
    // Even when the entry behind holds the same URL: the cursor must not move.
    const twice = at(["/a", "/a"], 1);
    expect(navPop(twice, "/a")).toBe(twice);
  });

  it("rewrites the current entry for a URL the mirror never saw", () => {
    expect(navPop(at(["/a", "/b"], 1), "/zzz")).toEqual(at(["/a", "/zzz"], 1));
  });
});

describe("navPreviousIs", () => {
  it("is true only for the entry one step back", () => {
    expect(navPreviousIs(at(["/a", "/b"], 1), "/a")).toBe(true);
    expect(navPreviousIs(at(["/a", "/b"], 1), "/b")).toBe(false);
    expect(navPreviousIs(at(["/a"], 0), "/a")).toBe(false);
    expect(navPreviousIs(at([], -1), "/a")).toBe(false);
  });
});

describe("a Bird's eye focus round trip keeps the mirror true", () => {
  it("push into focus, back out, and the bar's back goes past Bird's eye", () => {
    // Clicking the Bird's eye tab is a search-only Link: the pathname
    // recorder never saw it, so the page rewrites the current entry first.
    let m = at(["/home", "/spaces/d"], 1);
    m = navReplace(m, "/spaces/d?view=birdseye");
    m = navPush(m, "/spaces/d?view=birdseye&focus=l1");
    expect(navPreviousIs(m, "/spaces/d?view=birdseye")).toBe(true);
    // Leaving focus steps the mirror back, then the popstate lands on it.
    m = { ...m, idx: m.idx - 1 };
    m = navPop(m, "/spaces/d?view=birdseye");
    expect(m).toEqual(at(["/home", "/spaces/d?view=birdseye", "/spaces/d?view=birdseye&focus=l1"], 1));
    expect(navPreviousIs(m, "/home")).toBe(true);
  });
});

describe("isDrawerEntry", () => {
  it("is a task's or a person's own URL, with or without a query", () => {
    expect(isDrawerEntry("/item/abc")).toBe(true);
    expect(isDrawerEntry("/item/abc?comment=c1&list=l1")).toBe(true);
    expect(isDrawerEntry("/people/u1")).toBe(true);
    expect(isDrawerEntry("/people/u1?from=team")).toBe(true);
  });

  it("is not a page beside the record, a list, or a deeper path", () => {
    for (const url of ["/people/me", "/people/departments", "/people/roles", "/people/skills", "/people", "/teams/directory", "/item", "/item/abc/history", "/boards/b1", "/home"]) {
      expect(isDrawerEntry(url)).toBe(false);
    }
  });
});

describe("drawerStepsBack", () => {
  it("is one step from a drawer opened over a list", () => {
    expect(drawerStepsBack(at(["/teams/directory", "/people/u1"], 1))).toBe(1);
  });

  it("goes past every record opened while the drawer was open, in one go", () => {
    expect(drawerStepsBack(at(["/home", "/teams/directory", "/people/u1", "/people/u2", "/people/u3"], 4))).toBe(3);
    expect(drawerStepsBack(at(["/boards/b1", "/item/t1", "/item/t2", "/people/u1"], 3))).toBe(3);
  });

  it("stops on the first entry when the run starts the mirror (that one was a full page)", () => {
    expect(drawerStepsBack(at(["/item/t1", "/item/t2"], 1))).toBe(1);
  });

  it("is 0 when the current entry is not a drawer's, or is the first", () => {
    expect(drawerStepsBack(at(["/teams/directory", "/people/u1", "/home"], 2))).toBe(0);
    expect(drawerStepsBack(at(["/people/u1"], 0))).toBe(0);
    expect(drawerStepsBack(at([], -1))).toBe(0);
  });

  it("counts from the cursor, not the end of the stack", () => {
    expect(drawerStepsBack(at(["/teams/directory", "/people/u1", "/people/u2"], 1))).toBe(1);
  });
});
