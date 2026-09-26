import { describe, expect, it } from "vitest";
import { pick, readSurface, surfacePatch } from "./surface-prefs";

describe("surface prefs", () => {
  it("reads one surface and ignores junk", () => {
    const prefs = { home: { work: { surface: { "agents.runs": { sortKey: "oldest", columns: ["a", 3], viewOptions: { pageSize: 50 } }, bad: 4 } } } };
    expect(readSurface(prefs, "agents.runs")).toEqual({ sortKey: "oldest", columns: ["a"], viewOptions: { pageSize: 50 } });
    expect(readSurface(prefs, "bad")).toEqual({});
    expect(readSurface(null, "x")).toEqual({});
  });
  it("writes a deep-mergeable patch", () => {
    expect(surfacePatch("sidekick.allChats", { sortKey: "title" })).toEqual({ home: { work: { surface: { "sidekick.allChats": { sortKey: "title" } } } } });
  });
  it("picks only allowed values", () => {
    expect(pick("title", ["recent", "title"] as const, "recent")).toBe("title");
    expect(pick("nope", ["recent", "title"] as const, "recent")).toBe("recent");
  });
});
