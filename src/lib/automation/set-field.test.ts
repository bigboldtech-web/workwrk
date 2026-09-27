import { describe, expect, it } from "vitest";
import { coerceSetFieldValue } from "./set-field";

const now = new Date(2026, 8, 26, 12);

describe("coerceSetFieldValue", () => {
  it("refuses a field type an automation cannot fill, even with a value", () => {
    for (const type of ["PEOPLE", "RELATIONSHIP", "FORMULA", "MULTI_SELECT"]) {
      expect(coerceSetFieldValue({ key: "x", type }, "anything").ok).toBe(false);
      expect(coerceSetFieldValue({ key: "x", type }, "").ok).toBe(false);
    }
  });
  it("an empty value clears the field", () => {
    expect(coerceSetFieldValue({ key: "x", type: "NUMBER" }, "")).toEqual({ ok: true, value: null });
  });
  it("numbers, with thousands separators", () => {
    expect(coerceSetFieldValue({ key: "x", type: "MONEY" }, "1,250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(coerceSetFieldValue({ key: "x", type: "NUMBER" }, "lots").ok).toBe(false);
  });
  it("checkboxes read yes and no", () => {
    expect(coerceSetFieldValue({ key: "x", type: "CHECKBOX" }, "Yes")).toEqual({ ok: true, value: true });
    expect(coerceSetFieldValue({ key: "x", type: "CHECKBOX" }, "0")).toEqual({ ok: true, value: false });
    expect(coerceSetFieldValue({ key: "x", type: "CHECKBOX" }, "maybe").ok).toBe(false);
  });
  it("dates: YYYY-MM-DD, today, and +N days", () => {
    expect(coerceSetFieldValue({ key: "x", type: "DATE" }, "2026-02-28", now)).toEqual({ ok: true, value: "2026-02-28" });
    expect(coerceSetFieldValue({ key: "x", type: "DATE" }, "2026-02-30", now).ok).toBe(false);
    expect(coerceSetFieldValue({ key: "x", type: "DATE" }, "today", now)).toEqual({ ok: true, value: "2026-09-26" });
    expect(coerceSetFieldValue({ key: "x", type: "DATE" }, "+7", now)).toEqual({ ok: true, value: "2026-10-03" });
  });
  it("a dropdown takes a choice by value or label, never anything else", () => {
    const f = { key: "x", type: "DROPDOWN", choices: [{ value: "c1", label: "Planned" }] };
    expect(coerceSetFieldValue(f, "planned")).toEqual({ ok: true, value: "c1" });
    expect(coerceSetFieldValue(f, "c1")).toEqual({ ok: true, value: "c1" });
    expect(coerceSetFieldValue(f, "Other").ok).toBe(false);
  });
  it("text is trimmed and kept", () => {
    expect(coerceSetFieldValue({ key: "x", type: "TEXT" }, "  hi  ")).toEqual({ ok: true, value: "hi" });
  });
});
