import { describe, expect, it } from "vitest";
import { unscopedTableVisible } from "./table-visibility";

describe("unscopedTableVisible", () => {
  it("shows an unscoped table to every Member, Admin and Owner", () => {
    for (const role of ["MEMBER", "ADMIN", "OWNER"] as const) {
      expect(unscopedTableVisible("someone-else", "me", role)).toBe(true);
    }
  });
  it("shows a Guest only a table the Guest made", () => {
    expect(unscopedTableVisible("someone-else", "me", "GUEST")).toBe(false);
    expect(unscopedTableVisible(null, "me", "GUEST")).toBe(false);
    expect(unscopedTableVisible("me", "me", "GUEST")).toBe(true);
  });
});
