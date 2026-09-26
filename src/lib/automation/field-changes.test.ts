import { describe, expect, it } from "vitest";
import { fieldChanges } from "./field-changes";

describe("fieldChanges", () => {
  it("reports one change per built-in field that the save changed", () => {
    const out = fieldChanges({ title: "A", priority: "LOW", dueAt: null }, { title: "B", priority: "HIGH" });
    expect(out).toEqual([
      { field: "title", value: "B", previousValue: "A" },
      { field: "priority", value: "HIGH", previousValue: "LOW" },
    ]);
  });

  it("ignores a field the save did not send, and one sent unchanged", () => {
    expect(fieldChanges({ title: "A", priority: "LOW" }, { title: "A" })).toEqual([]);
  });

  it("treats the same instant as a Date and as a string as unchanged", () => {
    const d = new Date("2026-09-26T10:00:00.000Z");
    expect(fieldChanges({ dueAt: d }, { dueAt: "2026-09-26T10:00:00.000Z" })).toEqual([]);
    expect(fieldChanges({ dueAt: d }, { dueAt: "2026-09-27T10:00:00.000Z" })).toHaveLength(1);
  });

  it("clearing a date reads as null, never undefined", () => {
    expect(fieldChanges({ startAt: new Date("2026-01-01T00:00:00Z") }, { startAt: null })).toEqual([
      { field: "startAt", value: null, previousValue: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("only List fields fire from metadata, never a watcher or internal key", () => {
    const out = fieldChanges(
      { metadata: { budget: 10, watcherIds: ["a"] } },
      { metadata: { budget: 12, watcherIds: ["a", "b"] } },
      ["budget"],
    );
    expect(out).toEqual([{ field: "budget", value: 12, previousValue: 10 }]);
  });

  it("an empty string and a missing value are the same (no event)", () => {
    expect(fieldChanges({ metadata: {} }, { metadata: { note: "" } }, ["note"])).toEqual([]);
  });
});
