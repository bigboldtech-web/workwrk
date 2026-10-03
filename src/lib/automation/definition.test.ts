import { describe, expect, it } from "vitest";
import {
  definitionWithScope,
  restoreHiddenScope,
  splitScope,
  MAX_SCOPE_IDS,
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

describe("hidden scope", () => {
  // The editor can open L1, F1 and S1; L-admin and S-hr are an Admin's.
  const canOpen = new Set(["list:L1", "list:L2", "folder:F1", "space:S1"]);
  const readable = (kind: string, id: string) => canOpen.has(`${kind}:${id}`);
  const stored = { listIds: ["L1", "L-admin"], folderIds: ["F1"], spaceIds: ["S-hr"] };
  const { shown, hidden } = splitScope(stored, readable);

  it("splits a stored scope into what the editor can open and the rest, in order", () => {
    expect(shown).toEqual({ listIds: ["L1"], folderIds: ["F1"], spaceIds: [] });
    expect(hidden).toEqual({ listIds: ["L-admin"], folderIds: [], spaceIds: ["S-hr"] });
  });

  it("keeps the hidden places when a manager edits an Admin's automation", () => {
    const r = restoreHiddenScope({ stored, submitted: { listIds: ["L1", "L2"], folderIds: [], spaceIds: [] }, hidden, readable, everywhere: false });
    expect(r).toEqual({ ok: true, scope: { listIds: ["L1", "L2", "L-admin"], folderIds: [], spaceIds: ["S-hr"] } });
  });

  it("an all-hidden scope saved unchanged keeps its places, never widens to Everywhere", () => {
    const allHidden = { listIds: ["L-admin"], folderIds: [], spaceIds: [] };
    const split = splitScope(allHidden, readable);
    expect(split.shown).toEqual({ listIds: [], folderIds: [], spaceIds: [] });
    const r = restoreHiddenScope({ stored: allHidden, submitted: split.shown, hidden: split.hidden, readable, everywhere: false });
    expect(r).toEqual({ ok: true, scope: allHidden });
  });

  it("an older tab that states no choice over hidden places is refused, not guessed", () => {
    expect(restoreHiddenScope({ stored, submitted: { listIds: [], folderIds: [], spaceIds: [] }, hidden, readable, everywhere: undefined })).toEqual({ ok: false, error: "scope_ambiguous" });
  });

  it("Everywhere is honoured, it covers every hidden place", () => {
    expect(restoreHiddenScope({ stored, submitted: { listIds: [], folderIds: [], spaceIds: [] }, hidden, readable, everywhere: true })).toEqual({ ok: true, scope: { listIds: [], folderIds: [], spaceIds: [] } });
  });

  it("a place the editor cannot open is refused unless it was already stored", () => {
    expect(restoreHiddenScope({ stored, submitted: { listIds: ["L-secret"], folderIds: [], spaceIds: [] }, hidden, readable, everywhere: false })).toEqual({ ok: false, error: "scope_locked" });
    expect(restoreHiddenScope({ stored, submitted: { listIds: ["L-admin"], folderIds: [], spaceIds: [] }, hidden, readable, everywhere: false })).toEqual({ ok: true, scope: { listIds: ["L-admin"], folderIds: [], spaceIds: ["S-hr"] } });
  });

  it("past the cap the save is refused, never cut", () => {
    const many = Array.from({ length: MAX_SCOPE_IDS }, (_, i) => `M${i}`);
    const wide = (kind: string, id: string) => kind === "list" && id.startsWith("M");
    const r = restoreHiddenScope({ stored: { listIds: ["L-admin"], folderIds: [], spaceIds: [] }, submitted: { listIds: many, folderIds: [], spaceIds: [] }, hidden: { listIds: ["L-admin"], folderIds: [], spaceIds: [] }, readable: wide, everywhere: false });
    expect(r).toEqual({ ok: false, error: "too_many_places" });
  });

  it("definitionWithScope replaces only the scope and drops it for Everywhere", () => {
    const def = { actions: [{ key: "notify" }], scope: stored, when: { field: "status" } };
    expect(definitionWithScope(def, shown)).toEqual({ actions: [{ key: "notify" }], when: { field: "status" }, scope: shown });
    expect(definitionWithScope(def, { listIds: [], folderIds: [], spaceIds: [] })).toEqual({ actions: [{ key: "notify" }], when: { field: "status" } });
  });
});
