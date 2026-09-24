import { describe, expect, it } from "vitest";
import {
  buildConnections,
  computeMirror,
  connectTargets,
  fieldKeySets,
  isConnectField,
  mergeConnectValue,
  mergeHiddenTargets,
  mirrorOptionsOf,
  redactFieldForViewer,
  rollupValues,
  validateConnectOptionsShape,
  validateConnectWrite,
  validateMirrorOptions,
  MAX_CONNECTIONS,
  MAX_CONNECT_TARGETS,
  type ConnectionRef,
} from "./list-connect";
import type { FieldDef } from "./field-catalog";

const connect = { key: "deps", label: "Depends on", type: "RELATIONSHIP", position: 0, options: { targetBoardIds: ["T1", "T2"] } } as unknown as FieldDef;
const docLink = { key: "doc", label: "Doc", type: "RELATIONSHIP", position: 1 } as FieldDef;
const mirror = { key: "m", label: "Mirror", type: "MIRROR", position: 2, options: { linkFieldKey: "deps", lookupFieldKeys: { T1: "points", T2: "__builtin_status" } } } as unknown as FieldDef;
const text = { key: "note", label: "Note", type: "TEXT", position: 3 } as FieldDef;

describe("field modes", () => {
  it("tells a connect field from today's doc-link RELATIONSHIP", () => {
    expect(isConnectField(connect)).toBe(true);
    expect(isConnectField(docLink)).toBe(false);
    expect(connectTargets(connect)).toEqual(["T1", "T2"]);
    expect(connectTargets(docLink)).toEqual([]);
  });
  it("splits a schema into stored, connect and mirror keys", () => {
    const s = fieldKeySets([connect, docLink, mirror, text]);
    expect([...s.stored]).toEqual(["deps", "doc", "note"]);
    expect([...s.connect]).toEqual(["deps"]);
    expect([...s.mirror]).toEqual(["m"]);
  });
  it("reads mirror options and ignores an unknown rollup", () => {
    expect(mirrorOptionsOf(mirror)).toEqual({ linkFieldKey: "deps", lookupFieldKeys: { T1: "points", T2: "__builtin_status" } });
    expect(mirrorOptionsOf({ ...mirror, options: { linkFieldKey: "deps", lookupFieldKeys: {}, rollupFn: "MEDIAN" } } as FieldDef)).toEqual({ linkFieldKey: "deps", lookupFieldKeys: {} });
    expect(mirrorOptionsOf(text)).toBeNull();
  });
});

describe("validateConnectOptionsShape", () => {
  it("accepts one to ten unique ids", () => {
    expect(validateConnectOptionsShape({ targetBoardIds: ["a"] })).toEqual({ ok: true, targetBoardIds: ["a"] });
    const ten = Array.from({ length: MAX_CONNECT_TARGETS }, (_, i) => `l${i}`);
    expect(validateConnectOptionsShape({ targetBoardIds: ten }).ok).toBe(true);
  });
  it("refuses none, eleven, duplicates and non-strings", () => {
    expect(validateConnectOptionsShape({ targetBoardIds: [] }).ok).toBe(false);
    expect(validateConnectOptionsShape({ targetBoardIds: Array.from({ length: 11 }, (_, i) => `l${i}`) }).ok).toBe(false);
    expect(validateConnectOptionsShape({ targetBoardIds: ["a", "a"] }).ok).toBe(false);
    expect(validateConnectOptionsShape({ targetBoardIds: ["a", 3] }).ok).toBe(false);
    expect(validateConnectOptionsShape({}).ok).toBe(false);
  });
});

describe("validateMirrorOptions", () => {
  const targetFields = new Map<string, FieldDef[]>([
    ["T1", [{ key: "points", label: "Points", type: "NUMBER", position: 0 } as FieldDef, { key: "files", label: "Files", type: "FILES", position: 1 } as FieldDef]],
    ["T2", [{ key: "owner_note", label: "Note", type: "TEXT", position: 0 } as FieldDef]],
  ]);
  const ctx = { fields: [connect, text], targetFields, readableTargets: new Set(["T1", "T2"]) };

  it("accepts a lookup per readable target and normalises the options", () => {
    const r = validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T1: "points" }, rollupFn: "SUM", junk: 1 }, ctx);
    expect(r).toEqual({ ok: true, options: { linkFieldKey: "deps", lookupFieldKeys: { T1: "points" }, rollupFn: "SUM" } });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T2: "__builtin_status" } }, ctx).ok).toBe(true);
  });
  it("needs a connect field on THIS List", () => {
    expect(validateMirrorOptions({ linkFieldKey: "note", lookupFieldKeys: { T1: "points" } }, ctx)).toEqual({ ok: false, issue: "link_field_not_connect" });
    expect(validateMirrorOptions({ linkFieldKey: "nope", lookupFieldKeys: { T1: "points" } }, ctx)).toEqual({ ok: false, issue: "link_field_not_connect" });
  });
  it("refuses a lookup into an unreadable or non-target List, or of an unknown or unshowable field", () => {
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T1: "points" } }, { ...ctx, readableTargets: new Set(["T2"]) })).toEqual({ ok: false, issue: "unknown_lookup" });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T9: "points" } }, ctx)).toEqual({ ok: false, issue: "unknown_lookup" });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T1: "nope" } }, ctx)).toEqual({ ok: false, issue: "unknown_lookup" });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T1: "files" } }, ctx)).toEqual({ ok: false, issue: "unknown_lookup" });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: {} }, ctx)).toEqual({ ok: false, issue: "no_lookups" });
  });
  it("lets SUM, AVG, MIN and MAX read only numeric fields", () => {
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T2: "owner_note" }, rollupFn: "MAX" }, ctx)).toEqual({ ok: false, issue: "rollup_not_numeric" });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T2: "__builtin_status" }, rollupFn: "AVG" }, ctx)).toEqual({ ok: false, issue: "rollup_not_numeric" });
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T2: "owner_note" }, rollupFn: "CONCAT" }, ctx).ok).toBe(true);
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T2: "owner_note" }, rollupFn: "COUNT" }, ctx).ok).toBe(true);
    expect(validateMirrorOptions({ linkFieldKey: "deps", lookupFieldKeys: { T1: "points" }, rollupFn: "MEDIAN" }, ctx)).toEqual({ ok: false, issue: "invalid_rollup" });
  });
});

describe("redactFieldForViewer and mergeHiddenTargets", () => {
  it("shows only readable targets and lookups, and says nothing about the rest", () => {
    const c = redactFieldForViewer(connect, new Set(["T2"]));
    expect((c.options as { targetBoardIds: string[] }).targetBoardIds).toEqual(["T2"]);
    const m = redactFieldForViewer(mirror, new Set(["T1"]));
    expect((m.options as { lookupFieldKeys: Record<string, string> }).lookupFieldKeys).toEqual({ T1: "points" });
    expect(JSON.stringify(c)).not.toContain("T1");
    expect(redactFieldForViewer(text, new Set())).toBe(text);
  });
  it("keeps every hidden target exactly as stored when an editor saves", () => {
    expect(mergeHiddenTargets(connect, { targetBoardIds: ["T2", "T3"] }, new Set(["T2", "T3"]))).toEqual({ targetBoardIds: ["T2", "T3", "T1"] });
    expect(mergeHiddenTargets(connect, { targetBoardIds: [] }, new Set(["T2"]))).toEqual({ targetBoardIds: ["T1"] });
    expect(mergeHiddenTargets(mirror, { linkFieldKey: "deps", lookupFieldKeys: { T1: "points2" } }, new Set(["T1"]))).toEqual({
      linkFieldKey: "deps",
      lookupFieldKeys: { T2: "__builtin_status", T1: "points2" },
    });
  });
});

describe("validateConnectWrite", () => {
  const resolvable = new Set(["a", "b"]);
  it("accepts resolvable ids and a clear", () => {
    expect(validateConnectWrite(["a", "b", "a"], { resolvable })).toEqual({ ok: true, ids: ["a", "b"] });
    expect(validateConnectWrite(null, { resolvable })).toEqual({ ok: true, ids: [] });
  });
  it("refuses an unresolvable id, the task itself and a wrong shape", () => {
    expect(validateConnectWrite(["a", "zz"], { resolvable })).toEqual({ ok: false, error: "invalid_connection" });
    expect(validateConnectWrite(["a"], { resolvable, selfId: "a" })).toEqual({ ok: false, error: "invalid_connection" });
    expect(validateConnectWrite({ kind: "DOC", id: "x" }, { resolvable })).toEqual({ ok: false, error: "invalid_connection" });
    expect(validateConnectWrite([""], { resolvable })).toEqual({ ok: false, error: "invalid_connection" });
  });
  it("lets an already stored id through even when it is no longer resolvable", () => {
    expect(validateConnectWrite(["old"], { resolvable, alreadyStored: new Set(["old"]) })).toEqual({ ok: true, ids: ["old"] });
  });
  it("caps a create at MAX_CONNECTIONS", () => {
    const many = Array.from({ length: MAX_CONNECTIONS + 1 }, (_, i) => `t${i}`);
    expect(validateConnectWrite(many, { resolvable: new Set(many) })).toEqual({ ok: false, error: "too_many_connections" });
  });
});

describe("mergeConnectValue", () => {
  it("keeps connections the writer cannot see", () => {
    const r = mergeConnectValue(["seen", "hidden"], ["new"], { readable: new Set(["seen", "new"]), live: new Set(["seen", "hidden", "new"]) });
    expect(r).toEqual({ ok: true, ids: ["new", "hidden"] });
    expect(mergeConnectValue(["seen", "hidden"], null, { readable: new Set(["seen"]), live: new Set() })).toEqual({ ok: true, ids: ["hidden"] });
  });
  it("never counts deleted tasks and refuses rather than truncates", () => {
    const live = Array.from({ length: MAX_CONNECTIONS }, (_, i) => `t${i}`);
    const withGone = mergeConnectValue(["gone1", "gone2"], live, { readable: new Set(live), live: new Set(live) });
    expect(withGone.ok).toBe(true);
    const over = mergeConnectValue([], [...live, "one-more"], { readable: new Set(), live: new Set([...live, "one-more"]) });
    expect(over).toEqual({ ok: false, error: "too_many_connections" });
  });
});

describe("connections and mirrors", () => {
  const info = new Map<string, ConnectionRef>([
    ["a", { id: "a", title: "A", statusLabel: "To Do", statusColor: "#000", done: false }],
  ]);
  it("builds connections from readable ids only", () => {
    expect(buildConnections(["hidden", "a"], info)).toEqual([info.get("a")]);
  });
  it("rolls values up", () => {
    expect(rollupValues("SUM", [1, "2", null, "x"])).toBe(3);
    expect(rollupValues("AVG", [2, 4])).toBe(3);
    expect(rollupValues("MIN", [5, 3])).toBe(3);
    expect(rollupValues("MAX", [5, 3])).toBe(5);
    expect(rollupValues("MAX", ["x"])).toBeNull();
    expect(rollupValues("COUNT", [1, "", null, [], "a"])).toBe(2);
    expect(rollupValues("CONCAT", ["a", ["b", "c"], null])).toBe("a, b, c");
  });
  it("builds a mirror only from tasks the lookup answers for", () => {
    const opts = { linkFieldKey: "deps", lookupFieldKeys: { T1: "points" }, rollupFn: "SUM" as const };
    const values: Record<string, number> = { a: 3, b: 4 };
    const m = computeMirror(["a", "hidden", "b", "other"], opts, (id) =>
      id in values ? { listId: "T1", read: () => values[id] } : id === "other" ? { listId: "T9", read: () => 100 } : null,
    );
    expect(m).toEqual({ values: [3, 4], rollup: 7 });
    expect(computeMirror(["a"], { linkFieldKey: "deps", lookupFieldKeys: { T1: "points" } }, () => ({ listId: "T1", read: () => 1 }))).toEqual({ values: [1] });
  });
});
