import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isValidDefaultFieldValue,
  listDefaultsSchema,
  mergeJsonObject,
  parseRowColorRules,
  parseViewComfort,
  planCreateDefaults,
  readListDefaults,
  rowColorRuleSchema,
  userIdsInDefaults,
  validateListDefaults,
  FILTER_OPERATORS,
  MAX_ROW_COLOR_RULES,
} from "./list-comfort";
import type { FieldDef } from "./field-catalog";
import type { StatusOption } from "./board-items-shared";

const statuses: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#000", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#000", group: "DONE" },
];
const fields: FieldDef[] = [
  { key: "points", label: "Points", type: "NUMBER", position: 0 },
  { key: "size", label: "Size", type: "DROPDOWN", position: 1, options: { choices: [{ value: "s", label: "S" }, { value: "l", label: "L" }] } },
  { key: "reviewer", label: "Reviewer", type: "USER", position: 2 },
  { key: "team", label: "Team", type: "PEOPLE", position: 3 },
  { key: "files", label: "Files", type: "FILES", position: 4 },
  { key: "tags2", label: "Labels", type: "LABELS", position: 5, options: { choices: [{ value: "a", label: "A" }] } },
];

describe("the filter operator vocabulary", () => {
  it("is exactly the board filter bar's", () => {
    const src = readFileSync(join(__dirname, "../components/board-view/board-filter-bar.tsx"), "utf8");
    const m = /const ALL_OPERATORS: readonly FilterOperator\[\] = \[([^\]]*)\]/.exec(src);
    expect(m).not.toBeNull();
    const theirs = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect([...FILTER_OPERATORS]).toEqual(theirs);
  });
});

describe("mergeJsonObject", () => {
  it("merges over the stored value, deletes on null, keeps the rest", () => {
    expect(mergeJsonObject({ a: 1, b: 2, sprint: { n: 1 } }, { b: null, c: 3, d: undefined })).toEqual({ a: 1, sprint: { n: 1 }, c: 3 });
    expect(mergeJsonObject(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeJsonObject([1, 2], { a: 1 })).toEqual({ a: 1 });
  });
});

describe("defaults", () => {
  it("parses strictly", () => {
    expect(listDefaultsSchema.safeParse({ status: "TO_DO", priority: "HIGH", fields: { points: 3 } }).success).toBe(true);
    expect(listDefaultsSchema.safeParse({ itemTypeId: "x" }).success).toBe(false);
    expect(listDefaultsSchema.safeParse({ priority: "MEGA" }).success).toBe(false);
    expect(listDefaultsSchema.safeParse({ assigneeIds: Array.from({ length: 21 }, (_, i) => `u${i}`) }).success).toBe(false);
  });
  it("validates against the List's statuses and fields", () => {
    expect(validateListDefaults({ status: "TO_DO", fields: { points: 3, size: "s" } }, { statuses, fields })).toEqual([]);
    expect(validateListDefaults({ status: "GONE" }, { statuses, fields })).toEqual(["status_not_in_list"]);
    expect(validateListDefaults({ fields: { nope: 1, points: "3", size: "xl", files: [] } }, { statuses, fields })).toEqual([
      "unknown_field:nope",
      "invalid_value:points",
      "invalid_value:size",
      "invalid_value:files",
    ]);
  });
  it("knows which values a type can default to", () => {
    expect(isValidDefaultFieldValue(fields[5], ["a"])).toBe(true);
    expect(isValidDefaultFieldValue(fields[5], ["z"])).toBe(false);
    expect(isValidDefaultFieldValue({ key: "c", label: "C", type: "CHECKBOX", position: 0 }, true)).toBe(true);
    expect(isValidDefaultFieldValue({ key: "d", label: "D", type: "DATE", position: 0 }, "2026-09-24")).toBe(true);
    expect(isValidDefaultFieldValue({ key: "r", label: "R", type: "RELATIONSHIP", position: 0 }, ["x"])).toBe(false);
  });
  it("collects every person a set of defaults names", () => {
    expect(userIdsInDefaults({ assigneeIds: ["u1"], fields: { reviewer: "u2", team: ["u3", "u1"] } }, fields).sort()).toEqual(["u1", "u2", "u3"]);
  });
  it("reads the task type from defaultItemTypeId, its one home", () => {
    expect(readListDefaults({ defaults: { priority: "LOW" }, defaultItemTypeId: "type1" })).toEqual({ priority: "LOW", itemTypeId: "type1" });
    expect(readListDefaults({ defaults: { itemTypeId: "sneaky" } })).toEqual({ itemTypeId: null });
    expect(readListDefaults(null)).toEqual({ itemTypeId: null });
  });
});

describe("planCreateDefaults", () => {
  const live = {
    statuses,
    fields,
    liveUserIds: new Set(["u1", "u3"]),
    liveTagIds: new Set(["t1"]),
    liveItemTypeIds: new Set(["type1"]),
  };
  const defaults = {
    status: "DONE",
    priority: "HIGH",
    assigneeIds: ["u1", "gone"],
    tagIds: ["t1", "archived"],
    itemTypeId: "type1",
    fields: { points: 5, reviewer: "gone", team: ["u3", "gone"], size: "xl" },
  };
  it("applies only to keys the creator did not send, and re-checks each value", () => {
    const plan = planCreateDefaults(defaults, { ...live, sentKeys: new Set(), sentMetadataKeys: new Set() });
    expect(plan).toEqual({
      status: "DONE",
      priority: "HIGH",
      assigneeIds: ["u1"],
      tagIds: ["t1"],
      itemTypeId: "type1",
      fields: { points: 5, team: ["u3"] },
    });
  });
  it("never overrides a sent key, an explicit null included", () => {
    const plan = planCreateDefaults(defaults, {
      ...live,
      sentKeys: new Set(["status", "priority", "ownerId", "tagIds", "itemTypeId"]),
      sentMetadataKeys: new Set(["points"]),
    });
    expect(plan).toEqual({ fields: { team: ["u3"] } });
  });
  it("skips a default that has stopped being true", () => {
    const plan = planCreateDefaults({ status: "REMOVED", itemTypeId: "deleted-type" }, { ...live, sentKeys: new Set(), sentMetadataKeys: new Set() });
    expect(plan).toEqual({});
  });
});

describe("row colour rules", () => {
  it("validates a rule", () => {
    expect(rowColorRuleSchema.safeParse({ id: "r1", field: "status", operator: "is", value: "DONE", color: "green" }).success).toBe(true);
    expect(rowColorRuleSchema.safeParse({ id: "r1", field: "status", operator: "matches", value: "x", color: "green" }).success).toBe(false);
    expect(rowColorRuleSchema.safeParse({ id: "r1", field: "status", operator: "is", value: "x", color: "#ff0000" }).success).toBe(false);
  });
  it("drops malformed and duplicate rules and caps the list", () => {
    const good = { id: "r1", field: "status", operator: "is", value: "DONE", color: "green" };
    expect(parseRowColorRules([good, { ...good }, { id: "r2", color: "pink" }, "x"])).toEqual([good]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...good, id: `r${i}` }));
    expect(parseRowColorRules(many)).toHaveLength(MAX_ROW_COLOR_RULES);
    expect(parseRowColorRules("nope")).toEqual([]);
  });
});

describe("parseViewComfort", () => {
  it("normalises the two keys and says nothing about absent ones", () => {
    expect(parseViewComfort({ pinnedColumns: ["__name", "points"], rowHeight: "compact", groupBy: "status" })).toEqual({
      ok: true,
      value: { pinnedColumns: ["__name", "points"], rowHeight: "compact" },
    });
    expect(parseViewComfort({ pinnedColumns: null, rowHeight: null })).toEqual({ ok: true, value: { pinnedColumns: null, rowHeight: null } });
    expect(parseViewComfort({})).toEqual({ ok: true, value: {} });
  });
  it("refuses a wrong value by name", () => {
    expect(parseViewComfort({ pinnedColumns: "points" })).toEqual({ ok: false, key: "pinnedColumns" });
    expect(parseViewComfort({ pinnedColumns: ["a", "a"] })).toEqual({ ok: false, key: "pinnedColumns" });
    expect(parseViewComfort({ rowHeight: "huge" })).toEqual({ ok: false, key: "rowHeight" });
  });
});
