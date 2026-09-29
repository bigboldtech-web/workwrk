// Publish must refuse a condition whose operator needs a value and has
// none: it would go live comparing against "" and never match, so the
// automation silently never runs (Phase 7 walk, finding 1).

import { describe, expect, it } from "vitest";
import { CONDITION_OPERATORS } from "./conditions";
import {
  EMPTY_CONDITION_MESSAGE,
  firstConditionMissingValue,
  hasProblems,
  publishProblems,
  readDraft,
} from "./builder-state";

const catalog = {
  triggers: [{ key: "task.created" }],
  actions: [{ key: "add_comment", name: "Add a comment", available: true, params: [{ key: "text", label: "Text", required: true }] }],
};

const wf = (rules: unknown[]) => ({
  name: "N",
  description: null,
  severity: "MINOR",
  triggerEvent: "task.created",
  definition: { conditions: { logic: "AND", rules }, actions: [{ key: "add_comment", params: { text: "hi" } }] },
});

const needsValue = CONDITION_OPERATORS.filter((o) => o.needsValue).map((o) => String(o.key));
const noValue = CONDITION_OPERATORS.filter((o) => !o.needsValue).map((o) => String(o.key));

describe("publishProblems: conditions", () => {
  it.each(needsValue)("refuses a %s condition with no value, under that row", (operator) => {
    const d = readDraft(wf([{ field: "priority", operator, value: "" }]));
    const p = publishProblems(d, catalog);
    expect(p.conditions[d.conditions[0].id]).toBe(EMPTY_CONDITION_MESSAGE);
    expect(hasProblems(p)).toBe(true);
  });

  it("treats whitespace as no value", () => {
    const d = readDraft(wf([{ field: "title", operator: "contains", value: "   " }]));
    expect(hasProblems(publishProblems(d, catalog))).toBe(true);
  });

  it.each(noValue)("lets a %s condition through without a value", (operator) => {
    const d = readDraft(wf([{ field: "ownerId", operator }]));
    const p = publishProblems(d, catalog);
    expect(p.conditions).toEqual({});
    expect(hasProblems(p)).toBe(false);
  });

  it("passes a complete condition and blames only the empty one", () => {
    const d = readDraft(wf([{ field: "priority", operator: "eq", value: "HIGH" }, { field: "priority", operator: "neq", value: "" }]));
    const p = publishProblems(d, catalog);
    expect(Object.keys(p.conditions)).toEqual([d.conditions[1].id]);
  });

  it("does not judge an API-authored nested group or a row with no field (toSaveBody drops that one)", () => {
    const d = readDraft(wf([{ logic: "OR", rules: [{ field: "a", operator: "eq", value: "" }] }]));
    d.conditions.push({ id: "blank", field: "", operator: "eq", value: "" });
    expect(hasProblems(publishProblems(d, catalog))).toBe(false);
  });
});

describe("firstConditionMissingValue (the publish route's check)", () => {
  it("finds the first flat rule with an empty, null or missing value", () => {
    expect(firstConditionMissingValue({ logic: "AND", rules: [{ field: "priority", operator: "eq", value: "HIGH" }, { field: "priority", operator: "eq", value: "" }] })).toBe(1);
    expect(firstConditionMissingValue({ logic: "AND", rules: [{ field: "dueAt", operator: "before", value: null }] })).toBe(0);
    expect(firstConditionMissingValue({ logic: "AND", rules: [{ field: "dueAt", operator: "within_next_days" }] })).toBe(0);
  });

  it("keeps a 0 and a false: they are values", () => {
    expect(firstConditionMissingValue({ logic: "AND", rules: [{ field: "n", operator: "gt", value: 0 }, { field: "b", operator: "eq", value: false }] })).toBeNull();
  });

  it("is null for no conditions, operators that take none, and nested groups", () => {
    expect(firstConditionMissingValue(null)).toBeNull();
    expect(firstConditionMissingValue({ logic: "AND", rules: [{ field: "ownerId", operator: "is_empty" }] })).toBeNull();
    expect(firstConditionMissingValue({ logic: "AND", rules: [{ logic: "OR", rules: [{ field: "a", operator: "eq", value: "" }] }] })).toBeNull();
  });
});
