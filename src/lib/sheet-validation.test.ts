import { describe, expect, it } from "vitest";
import { isEmptyValidation, validateValue, type DataValidation } from "./sheet-validation";

describe("validateValue", () => {
  it("passes when no validation or empty value", () => {
    expect(validateValue(undefined, "anything").ok).toBe(true);
    expect(validateValue({ kind: "number", min: 0 }, null).ok).toBe(true);
    expect(validateValue({ kind: "number", min: 0 }, "").ok).toBe(true);
  });

  it("list: value must be in the set, arrays check every element", () => {
    const v: DataValidation = { kind: "list", values: ["A", "B"] };
    expect(validateValue(v, "A").ok).toBe(true);
    expect(validateValue(v, "C").ok).toBe(false);
    expect(validateValue(v, ["A", "B"]).ok).toBe(true);
    expect(validateValue(v, ["A", "Z"]).ok).toBe(false);
  });

  it("number: enforces range and rejects non-numbers", () => {
    const v: DataValidation = { kind: "number", min: 1, max: 10 };
    expect(validateValue(v, 5).ok).toBe(true);
    expect(validateValue(v, 0).ok).toBe(false);
    expect(validateValue(v, 11).ok).toBe(false);
    expect(validateValue(v, "7").ok).toBe(true); // numeric string coerces
    expect(validateValue(v, "abc").ok).toBe(false);
  });

  it("textLength: enforces character bounds", () => {
    const v: DataValidation = { kind: "textLength", min: 2, max: 4 };
    expect(validateValue(v, "ab").ok).toBe(true);
    expect(validateValue(v, "a").ok).toBe(false);
    expect(validateValue(v, "abcde").ok).toBe(false);
  });

  it("isEmptyValidation drops no-op configs", () => {
    expect(isEmptyValidation(undefined)).toBe(true);
    expect(isEmptyValidation({ kind: "list", values: [] })).toBe(true);
    expect(isEmptyValidation({ kind: "number" })).toBe(true);
    expect(isEmptyValidation({ kind: "number", min: 0 })).toBe(false);
    expect(isEmptyValidation({ kind: "list", values: ["x"] })).toBe(false);
  });
});
