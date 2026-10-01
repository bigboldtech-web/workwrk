import { describe, expect, it } from "vitest";
import { DEFAULT_DEPARTMENTS, isSeededDepartmentSet } from "./default-departments";

describe("isSeededDepartmentSet", () => {
  it("is true for exactly the six seeded names, in any order and case", () => {
    expect(isSeededDepartmentSet([...DEFAULT_DEPARTMENTS])).toBe(true);
    expect(isSeededDepartmentSet(["finance", "HR", "operations", "Marketing", "sales", "ENGINEERING"])).toBe(true);
  });
  it("is false once someone added, removed or renamed one", () => {
    expect(isSeededDepartmentSet([...DEFAULT_DEPARTMENTS, "Support"])).toBe(false);
    expect(isSeededDepartmentSet(DEFAULT_DEPARTMENTS.slice(1))).toBe(false);
    expect(isSeededDepartmentSet(["Engineering", "Sales", "Marketing", "Operations", "People", "Finance"])).toBe(false);
    expect(isSeededDepartmentSet(["Engineering", "Engineering", "Sales", "Marketing", "Operations", "HR"])).toBe(false);
  });
});
