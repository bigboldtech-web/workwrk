import { describe, expect, it } from "vitest";
import {
  draftDiffersFromLive,
  draftTrigger,
  isEverywhere,
  liveDefinition,
  readScope,
  readSnapshotNote,
  scopeForSave,
  scopeMatches,
  stableJson,
  whenMatches,
  withoutSnapshotNote,
} from "./definition";

describe("readScope", () => {
  it("reads a missing scope as Everywhere, so rows written before scopes need no migration", () => {
    expect(isEverywhere(readScope({ actions: [] }))).toBe(true);
    expect(isEverywhere(readScope(null))).toBe(true);
    expect(isEverywhere(readScope("junk"))).toBe(true);
    expect(isEverywhere(readScope({ scope: { listIds: "b1" } }))).toBe(true);
  });

  it("keeps string ids, drops junk and duplicates", () => {
    const s = readScope({ scope: { listIds: ["b1", "b1", 3, "", " b2 "], spaceIds: ["s1"] } });
    expect(s.listIds).toEqual(["b1", "b2"]);
    expect(s.spaceIds).toEqual(["s1"]);
    expect(s.folderIds).toEqual([]);
  });
});

describe("scopeMatches", () => {
  const place = { boardId: "b1", folderId: "f1", spaceId: "s1" };

  it("Everywhere matches every event, including one with no List", () => {
    expect(scopeMatches(readScope({}), place)).toBe(true);
    expect(scopeMatches(readScope({}), null)).toBe(true);
  });

  it("a List scope matches only records in that List", () => {
    const s = readScope({ scope: { listIds: ["b1"] } });
    expect(scopeMatches(s, place)).toBe(true);
    expect(scopeMatches(s, { ...place, boardId: "b2" })).toBe(false);
  });

  it("a Folder or Space scope matches every List inside it", () => {
    expect(scopeMatches(readScope({ scope: { folderIds: ["f1"] } }), { boardId: "b9", folderId: "f1", spaceId: "s9" })).toBe(true);
    expect(scopeMatches(readScope({ scope: { spaceIds: ["s1"] } }), { boardId: "b9", folderId: null, spaceId: "s1" })).toBe(true);
    expect(scopeMatches(readScope({ scope: { spaceIds: ["s1"] } }), { boardId: "b9", folderId: null, spaceId: "s2" })).toBe(false);
  });

  it("a scoped automation never runs for an event that is in no List", () => {
    const s = readScope({ scope: { listIds: ["b1"] } });
    expect(scopeMatches(s, null)).toBe(false);
    expect(scopeMatches(s, { boardId: null, folderId: null, spaceId: null })).toBe(false);
  });
});

describe("scopeForSave", () => {
  it("stores nothing for Everywhere and a clean object otherwise", () => {
    expect(scopeForSave({ listIds: [] })).toBeUndefined();
    expect(scopeForSave(undefined)).toBeUndefined();
    expect(scopeForSave({ listIds: ["b1", "b1"] })).toEqual({ listIds: ["b1"], folderIds: [], spaceIds: [] });
  });
});

describe("draftTrigger", () => {
  it("prefers the draft key, falls back to the row column for older rows", () => {
    expect(draftTrigger({ trigger: "task.created" }, "task.status_changed")).toBe("task.created");
    expect(draftTrigger({}, "task.status_changed")).toBe("task.status_changed");
    expect(draftTrigger({ trigger: null }, "task.status_changed")).toBeNull();
    expect(draftTrigger(null, null)).toBeNull();
  });
});

describe("liveDefinition", () => {
  const draft = { actions: [{ key: "assign_user" }] };
  const published = { actions: [{ key: "update_status" }] };

  it("runs the published snapshot, never the draft", () => {
    expect(liveDefinition({ definition: draft, publishedVersionId: "v1" }, { id: "v1", definitionJson: published })).toBe(published);
  });

  it("falls back to the row's definition when there is no matching version", () => {
    expect(liveDefinition({ definition: draft, publishedVersionId: null }, null)).toBe(draft);
    expect(liveDefinition({ definition: draft, publishedVersionId: "v1" }, undefined)).toBe(draft);
    expect(liveDefinition({ definition: draft, publishedVersionId: "v1" }, { id: "v0", definitionJson: published })).toBe(draft);
  });
});

describe("whenMatches", () => {
  it("a field-change automation with a field picked runs only for that field", () => {
    expect(whenMatches("task.field_changed", { field: "priority" }, { field: "priority" })).toBe(true);
    expect(whenMatches("task.field_changed", { field: "priority" }, { field: "dueAt" })).toBe(false);
  });

  it("no field picked runs for every change, and other triggers have no event option", () => {
    expect(whenMatches("task.field_changed", {}, { field: "dueAt" })).toBe(true);
    expect(whenMatches("task.created", { field: "x" }, {})).toBe(true);
  });
});

describe("draftDiffersFromLive", () => {
  const def = { conditions: null, actions: [{ key: "a", params: { x: 1, y: 2 } }] };

  it("is false before the first publish and when nothing changed (key order ignored)", () => {
    expect(draftDiffersFromLive(def, "task.created", null, null)).toBe(false);
    const reordered = { actions: [{ params: { y: 2, x: 1 }, key: "a" }], conditions: null };
    expect(draftDiffersFromLive(def, "task.created", reordered, "task.created")).toBe(false);
  });

  it("sees an action change, a draft trigger change and a scope change", () => {
    expect(draftDiffersFromLive({ ...def, actions: [] }, "task.created", def, "task.created")).toBe(true);
    expect(draftDiffersFromLive({ ...def, trigger: "kudos.created" }, "task.created", def, "task.created")).toBe(true);
    expect(draftDiffersFromLive({ ...def, scope: { listIds: ["b1"] } }, "task.created", def, "task.created")).toBe(true);
  });

  it("ignores a snapshot marker on the published copy", () => {
    expect(draftDiffersFromLive(def, "t", { ...def, __snapshot: { reason: "kept-before-restore", restoredFrom: 1 } }, "t")).toBe(false);
  });
});

describe("snapshot notes", () => {
  it("reads and strips the kept-before-restore marker", () => {
    const v = { actions: [], __snapshot: { reason: "kept-before-restore", restoredFrom: 2 } };
    expect(readSnapshotNote(v)).toEqual({ reason: "kept-before-restore", restoredFrom: 2 });
    expect(withoutSnapshotNote(v)).toEqual({ actions: [] });
    expect(readSnapshotNote({ actions: [] })).toBeNull();
  });
});

describe("stableJson", () => {
  it("sorts keys and drops undefined", () => {
    expect(stableJson({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2},"b":1}');
  });
});
