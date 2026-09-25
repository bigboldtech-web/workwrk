import { describe, expect, it } from "vitest";
import { listFieldCarriesValue } from "./board-item-detail";

// The drawer's List fields section promises a field with a value is never
// hidden. A Mirror column's value lives in item.mirrors, not item.metadata,
// so the has-value check must read both or every mirror counts as empty.
describe("listFieldCarriesValue", () => {
  it("reads metadata values as before", () => {
    expect(listFieldCarriesValue({ metadata: { budget: 5 } }, "budget")).toBe(true);
    expect(listFieldCarriesValue({ metadata: { budget: "" } }, "budget")).toBe(false);
    expect(listFieldCarriesValue({ metadata: {} }, "budget")).toBe(false);
    expect(listFieldCarriesValue({ metadata: { other: 1 } }, "budget")).toBe(false);
  });

  it("counts a mirror with a readable value, which never has a metadata key", () => {
    const item = { metadata: { linked_work: ["x"] }, mirrors: { budget_mirror: { values: [100, 999] } } };
    expect(listFieldCarriesValue(item, "budget_mirror")).toBe(true);
    expect(listFieldCarriesValue({ metadata: {}, mirrors: { status_mirror: { values: ["To Do"] } } }, "status_mirror")).toBe(true);
  });

  it("treats a mirror whose values are all empty as empty", () => {
    expect(listFieldCarriesValue({ metadata: {}, mirrors: { m: { values: [] } } }, "m")).toBe(false);
    expect(listFieldCarriesValue({ metadata: {}, mirrors: { m: { values: [null, "", []] } } }, "m")).toBe(false);
  });

  it("counts a zero as a value, the same as a metadata number", () => {
    expect(listFieldCarriesValue({ metadata: {}, mirrors: { m: { values: [0] } } }, "m")).toBe(true);
  });

  it("counts resolved connections even when metadata lacks the ids", () => {
    const conn = [{ id: "a", title: "A", statusLabel: null, statusColor: null, done: false }];
    expect(listFieldCarriesValue({ metadata: {}, connections: { link: conn } }, "link")).toBe(true);
    expect(listFieldCarriesValue({ metadata: {}, connections: { link: [] } }, "link")).toBe(false);
  });
});
