import { describe, expect, it } from "vitest";
import {
  applyWatcherIds,
  autoWatch,
  notifyTargets,
  readWatchers,
  unwatch,
  watch,
  writeWatchers,
} from "./item-watchers";

describe("readWatchers", () => {
  it("reads nothing out of an absent or malformed metadata blob", () => {
    expect(readWatchers(undefined)).toEqual({ watchers: [], unwatchers: [] });
    expect(readWatchers(null)).toEqual({ watchers: [], unwatchers: [] });
    expect(readWatchers("nope")).toEqual({ watchers: [], unwatchers: [] });
    expect(readWatchers([1, 2])).toEqual({ watchers: [], unwatchers: [] });
  });

  it("reads the legacy `followers` key as watchers so nothing already picked is lost", () => {
    expect(readWatchers({ followers: ["u1", "u2"] })).toEqual({
      watchers: ["u1", "u2"],
      unwatchers: [],
    });
  });

  it("merges followers into watchers without duplicating", () => {
    expect(readWatchers({ watchers: ["u1"], followers: ["u1", "u2"] }).watchers).toEqual(["u1", "u2"]);
  });

  it("drops non-strings and duplicates", () => {
    expect(readWatchers({ watchers: ["u1", "u1", 7, null, ""] }).watchers).toEqual(["u1"]);
  });

  it("an unwatcher is never reported as a watcher, even from a stale array", () => {
    expect(readWatchers({ watchers: ["u1", "u2"], unwatchers: ["u1"] })).toEqual({
      watchers: ["u2"],
      unwatchers: ["u1"],
    });
  });
});

describe("rule 1 — auto-watch on acting", () => {
  it("adds actors who have not opted out", () => {
    const s = autoWatch({ watchers: ["u1"], unwatchers: [] }, ["u2", "u3"]);
    expect(s.watchers).toEqual(["u1", "u2", "u3"]);
  });

  it("leaves an unwatcher alone — this is what makes leaving stick", () => {
    const s = autoWatch({ watchers: [], unwatchers: ["u1"] }, ["u1", "u2"]);
    expect(s.watchers).toEqual(["u2"]);
    expect(s.unwatchers).toEqual(["u1"]);
  });

  it("ignores nulls and never duplicates", () => {
    const s = autoWatch({ watchers: ["u1"], unwatchers: [] }, [null, undefined, "u1"]);
    expect(s.watchers).toEqual(["u1"]);
  });
});

describe("rules 2 and 3 — unwatch sticks, watch clears it", () => {
  it("unwatch removes from watchers and records the opt-out", () => {
    expect(unwatch({ watchers: ["u1", "u2"], unwatchers: [] }, "u1")).toEqual({
      watchers: ["u2"],
      unwatchers: ["u1"],
    });
  });

  it("commenting again after unwatching does not re-subscribe", () => {
    const left = unwatch({ watchers: ["u1"], unwatchers: [] }, "u1");
    const commented = autoWatch(left, ["u1"]);
    expect(commented.watchers).toEqual([]);
  });

  it("watch adds and clears the opt-out, so a person can come back", () => {
    const left = unwatch({ watchers: ["u1"], unwatchers: [] }, "u1");
    expect(watch(left, "u1")).toEqual({ watchers: ["u1"], unwatchers: [] });
  });

  it("unwatch twice is idempotent", () => {
    const once = unwatch({ watchers: ["u1"], unwatchers: [] }, "u1");
    expect(unwatch(once, "u1")).toEqual(once);
  });
});

describe("rules 4 and 5 — the picker, and who may write an opt-out", () => {
  it("someone else adding you clears your opt-out (they can put you back on)", () => {
    const state = { watchers: ["u9"], unwatchers: ["u1"] };
    const next = applyWatcherIds(state, ["u9", "u1"], "u9");
    expect(next.watchers).toEqual(["u9", "u1"]);
    expect(next.unwatchers).toEqual([]);
  });

  it("someone else removing you does NOT silence you for good", () => {
    const next = applyWatcherIds({ watchers: ["u9", "u1"], unwatchers: [] }, ["u9"], "u9");
    expect(next.watchers).toEqual(["u9"]);
    expect(next.unwatchers).toEqual([]);
  });

  it("removing YOURSELF in the picker writes the opt-out", () => {
    const next = applyWatcherIds({ watchers: ["u9", "u1"], unwatchers: [] }, ["u9"], "u1");
    expect(next.watchers).toEqual(["u9"]);
    expect(next.unwatchers).toEqual(["u1"]);
  });

  it("a stale opt-out is honoured on the way out", () => {
    const next = applyWatcherIds({ watchers: [], unwatchers: ["u1"] }, ["u1", "u2"], "u2");
    // u1 was explicitly re-added by u2, so the opt-out clears (rule 4).
    expect(next.watchers).toEqual(["u1", "u2"]);
    expect(next.unwatchers).toEqual([]);
  });
});

describe("writeWatchers", () => {
  it("drops the legacy key once it has been folded in", () => {
    const md = writeWatchers({ description: "hi", followers: ["u1"] }, { watchers: ["u1"], unwatchers: [] });
    expect(md.followers).toBeUndefined();
    expect(md.watchers).toEqual(["u1"]);
    expect(md.unwatchers).toEqual([]);
    expect(md.description).toBe("hi");
  });

  it("never mutates the blob it was handed", () => {
    const original = { followers: ["u1"] };
    writeWatchers(original, { watchers: [], unwatchers: [] });
    expect(original).toEqual({ followers: ["u1"] });
  });

  it("a read of what it wrote round-trips", () => {
    const md = writeWatchers({}, { watchers: ["u1", "u2"], unwatchers: ["u3"] });
    expect(readWatchers(md)).toEqual({ watchers: ["u1", "u2"], unwatchers: ["u3"] });
  });
});

describe("notifyTargets", () => {
  it("is watchers minus the actor", () => {
    expect(notifyTargets({ watchers: ["u1", "u2"], unwatchers: [] }, "u1")).toEqual(["u2"]);
  });

  it("never returns an opt-out, even from a stale watcher array", () => {
    expect(notifyTargets({ watchers: ["u1", "u2"], unwatchers: ["u2"] }, null)).toEqual(["u1"]);
  });
});
