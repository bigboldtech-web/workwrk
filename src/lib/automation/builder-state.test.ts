import { describe, expect, it } from "vitest";
import {
  draftSnapshot,
  hasProblems,
  moveItem,
  operatorsFor,
  publishProblems,
  readDraft,
  toSaveBody,
  valueKindFor,
  whenFor,
} from "./builder-state";

const wf = (definition: unknown, triggerEvent: string | null = "task.created") => ({
  name: "N",
  description: null,
  severity: "MINOR",
  triggerEvent,
  definition,
});

describe("readDraft / toSaveBody", () => {
  it("round-trips a definition, including where it runs and the trigger options", () => {
    const def = {
      conditions: { logic: "OR", rules: [{ field: "priority", operator: "eq", value: "HIGH" }] },
      actions: [{ key: "create_task", params: { boardId: "b1", dueInDays: 2 } }],
      when: { field: "priority" },
      scope: { listIds: ["l1"] },
    };
    const d = readDraft(wf(def, "task.field_changed"));
    const body = toSaveBody(d, (k) => new Set(k === "create_task" ? ["dueInDays"] : []));
    expect(body.definition).toEqual({
      conditions: { logic: "OR", rules: [{ field: "priority", operator: "eq", value: "HIGH" }] },
      actions: [{ key: "create_task", params: { boardId: "b1", dueInDays: 2 } }],
      trigger: "task.field_changed",
      when: { field: "priority" },
      scope: { listIds: ["l1"], folderIds: [], spaceIds: [] },
      everywhere: false,
    });
  });

  it("a scope whose places are all hidden from this editor stays 'only in chosen places', never Everywhere", () => {
    const d = readDraft({ ...wf({ actions: [] }), scopeHidden: true });
    expect(d.everywhere).toBe(false);
    const def = toSaveBody(d).definition as Record<string, unknown>;
    expect(def.everywhere).toBe(false);
    expect("scope" in def).toBe(false);
  });

  it("an Everywhere automation states Everywhere on save", () => {
    const d = readDraft(wf({ actions: [] }));
    expect(d.everywhere).toBe(true);
    expect((toSaveBody(d).definition as Record<string, unknown>).everywhere).toBe(true);
  });

  it("keeps an API-authored nested condition group verbatim, never dropping it", () => {
    const nested = { logic: "AND", rules: [{ field: "a", operator: "eq", value: 1 }] };
    const d = readDraft(wf({ conditions: { logic: "AND", rules: [nested] }, actions: [] }));
    expect(d.conditions[0].opaque).toEqual(nested);
    expect((toSaveBody(d).definition as { conditions: { rules: unknown[] } }).conditions.rules[0]).toEqual(nested);
  });

  it("Everywhere writes no scope key, so the matcher reads it as Everywhere", () => {
    const d = readDraft(wf({ actions: [] }));
    expect("scope" in (toSaveBody(d).definition as object)).toBe(false);
  });

  it("drops the value of an operator that takes none", () => {
    const d = readDraft(wf({ conditions: { logic: "AND", rules: [{ field: "ownerId", operator: "is_empty", value: "x" }] } }));
    expect((toSaveBody(d).definition as { conditions: { rules: unknown[] } }).conditions.rules[0]).toEqual({ field: "ownerId", operator: "is_empty" });
  });
});

describe("draftSnapshot", () => {
  it("is equal for an untouched draft and changes with an edit, so the dirty flag is honest", () => {
    const def = { actions: [{ key: "assign_user", params: { userId: "actor" } }] };
    const a = readDraft(wf(def));
    const b = readDraft(wf(def));
    expect(draftSnapshot(a)).toBe(draftSnapshot(b));
    expect(draftSnapshot({ ...a, name: "Other" })).not.toBe(draftSnapshot(b));
  });
});

describe("whenFor", () => {
  it("keeps only the options the trigger reads, with safe defaults", () => {
    expect(whenFor("task.created", { field: "x" })).toEqual({});
    expect(whenFor("task.date_arrives", { offsetDays: -90 })).toEqual({ dateField: "dueAt", offsetDays: -30 });
    expect(whenFor("schedule.every", { every: "week" })).toEqual({ every: "week", at: "09:00", weekday: 1 });
  });
});

describe("typed values", () => {
  it("a person field gets the people picker, a date the date control", () => {
    expect(valueKindFor("user", "eq")).toBe("user");
    expect(valueKindFor("date", "before")).toBe("date");
    expect(valueKindFor("date", "within_next_days")).toBe("number");
    expect(valueKindFor("status", "eq")).toBe("status");
    expect(valueKindFor("string", "is_empty")).toBe("none");
  });
  it("offers only the operators that fit the field", () => {
    expect(operatorsFor("date")).not.toContain("contains");
    expect(operatorsFor("user")).toEqual(["eq", "neq", "is_empty", "is_not_empty"]);
  });
});

describe("publishProblems", () => {
  const catalog = {
    triggers: [{ key: "task.created" }],
    actions: [
      { key: "assign_user", name: "Assign a person", available: true, params: [{ key: "userId", label: "Assignee", required: true }] },
      { key: "send_whatsapp", name: "Send a WhatsApp message", available: false, params: [] },
    ],
  };
  it("says each problem under its own section", () => {
    const d = readDraft(wf({ actions: [{ key: "assign_user", params: {} }, { key: "send_whatsapp", params: {} }] }, null));
    const p = publishProblems(d, catalog);
    expect(p.when).toBeTruthy();
    expect(Object.values(p.actions)).toHaveLength(2);
    expect(hasProblems(p)).toBe(true);
  });
  it("a complete sentence has none", () => {
    const d = readDraft(wf({ actions: [{ key: "assign_user", params: { userId: "actor" } }] }));
    expect(hasProblems(publishProblems(d, catalog))).toBe(false);
  });
});

describe("moveItem", () => {
  it("reorders and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
