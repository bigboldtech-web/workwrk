import { describe, expect, it } from "vitest";
import { keyForLabel, profileFieldRows, readProfileFieldDefs, validateProfileFieldDefs, validateProfileValues } from "./profile-fields";

const defs = [{ key: "pronouns", label: "Pronouns" }, { key: "employee_id", label: "Employee ID" }];

describe("profile fields", () => {
  it("reads definitions and skips malformed rows", () => {
    const s = { people: { profileFields: [{ key: "pronouns", label: "Pronouns" }, { key: "Bad Key", label: "x" }, { key: "pronouns", label: "dup" }, { label: "no key" }] } };
    expect(readProfileFieldDefs(s)).toEqual([{ key: "pronouns", label: "Pronouns" }]);
    expect(readProfileFieldDefs(null)).toEqual([]);
    expect(readProfileFieldDefs({ people: "x" })).toEqual([]);
  });

  it("makes a unique key from a label", () => {
    expect(keyForLabel("Employee ID", [])).toBe("employee_id");
    expect(keyForLabel("Employee ID", ["employee_id"])).toBe("employee_id_2");
    expect(keyForLabel("!!!", [])).toBe("field");
  });

  it("validates a definitions list", () => {
    expect(validateProfileFieldDefs(defs)).toEqual({ ok: true, value: defs });
    expect(validateProfileFieldDefs([{ key: "a", label: "A" }, { key: "b", label: "a" }]).ok).toBe(false);
    expect(validateProfileFieldDefs([{ key: "A-B", label: "A" }]).ok).toBe(false);
    expect(validateProfileFieldDefs("x").ok).toBe(false);
  });

  it("accepts only defined keys and bounded text, and splits set from clear", () => {
    expect(validateProfileValues({ pronouns: " she/her ", employee_id: null }, defs)).toEqual({ ok: true, set: { pronouns: "she/her" }, remove: ["employee_id"] });
    expect(validateProfileValues({ shoe: "9" }, defs).ok).toBe(false);
    expect(validateProfileValues({ pronouns: "x".repeat(501) }, defs).ok).toBe(false);
    expect(validateProfileValues({ pronouns: 5 }, defs).ok).toBe(false);
    expect(validateProfileValues({}, defs).ok).toBe(false);
    expect(validateProfileValues(["x"], defs).ok).toBe(false);
  });

  it("lists defined fields with values, never undefined ones", () => {
    expect(profileFieldRows(defs, { pronouns: "they", old_field: "kept" })).toEqual([
      { key: "pronouns", label: "Pronouns", value: "they" },
      { key: "employee_id", label: "Employee ID", value: null },
    ]);
  });
});
