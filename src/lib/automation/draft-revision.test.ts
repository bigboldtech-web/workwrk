import { describe, expect, it } from "vitest";
import { draftRevision } from "./draft-revision";

const row = { name: "Notify on new", description: null, severity: "MINOR", definition: { trigger: "task.created", actions: [{ key: "create_notification", params: { userId: "u1" } }], scope: { listIds: ["L1"] } } };

describe("draftRevision", () => {
  it("is the same for the same draft, whatever the key order", () => {
    const reordered = { ...row, definition: { scope: { listIds: ["L1"] }, actions: [{ params: { userId: "u1" }, key: "create_notification" }], trigger: "task.created" } };
    expect(draftRevision(reordered)).toBe(draftRevision(row));
  });

  it("changes with anything the builder edits, a hidden place included", () => {
    const base = draftRevision(row);
    expect(draftRevision({ ...row, name: "Notify on new task" })).not.toBe(base);
    expect(draftRevision({ ...row, severity: "MAJOR" })).not.toBe(base);
    expect(draftRevision({ ...row, description: "x" })).not.toBe(base);
    expect(draftRevision({ ...row, definition: { ...row.definition, scope: { listIds: ["L1", "L-hidden"] } } })).not.toBe(base);
  });
});
