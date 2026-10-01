import { describe, expect, it } from "vitest";
import { acceptTypedNumber, numberFieldError } from "./settings-form";

// A person types into a bounded number field one keystroke at a time. The
// field shows what they typed; the form takes a number only when it is in
// range. Replays the keystrokes the way useTypedNumbers does and returns the
// text the field shows and every number the form was handed.
function typeInto(start: number, keys: string[], bounds: { min: number; max: number }) {
  let text = String(start);
  let held = start;
  const handed: number[] = [];
  for (const k of keys) {
    text = k === "clear" ? "" : k === "select" ? "" : text + k;
    if (k === "select") continue; // selecting the text replaces it on the next digit
    const n: number | "" = text === "" ? "" : Math.trunc(Number(text));
    const ok = acceptTypedNumber(n, bounds);
    if (ok !== null) { held = ok; handed.push(ok); }
  }
  return { text, held, handed };
}

describe("bounded number fields keep what is typed", () => {
  it("typing 12 into Minimum length (8 to 64) gives 12, never 8 or 64", () => {
    const r = typeInto(8, ["select", "1", "2"], { min: 8, max: 64 });
    expect(r.text).toBe("12");
    expect(r.held).toBe(12);
    expect(r.handed).toEqual([12]);
  });

  it("typing 45 into idle minutes (30 to 720) gives 45, never 30 or 305", () => {
    const r = typeInto(720, ["select", "4", "5"], { min: 30, max: 720 });
    expect(r.held).toBe(45);
    expect(r.handed).not.toContain(30);
    expect(r.handed).not.toContain(305);
  });

  it("typing 30 or 60 into lockout minutes (15 to 1440) gives that number, never 150", () => {
    expect(typeInto(15, ["select", "3", "0"], { min: 15, max: 1440 }).held).toBe(30);
    expect(typeInto(15, ["select", "6", "0"], { min: 15, max: 1440 }).held).toBe(60);
  });

  it("clearing Invitation expiry (1 to 90) and typing 3 gives 3, never 73", () => {
    const r = typeInto(7, ["clear", "3"], { min: 1, max: 90 });
    expect(r.text).toBe("3");
    expect(r.held).toBe(3);
    expect(r.handed).toEqual([3]);
  });

  it("a cleared field hands the form nothing, so it keeps its last valid value", () => {
    const r = typeInto(7, ["clear"], { min: 1, max: 90 });
    expect(r.text).toBe("");
    expect(r.held).toBe(7);
    expect(r.handed).toEqual([]);
  });

  it("an out-of-range number is never clamped into range", () => {
    expect(acceptTypedNumber(100, { min: 8, max: 64 })).toBeNull();
    expect(acceptTypedNumber(1, { min: 8, max: 64 })).toBeNull();
    expect(acceptTypedNumber("", { min: 8, max: 64 })).toBeNull();
    expect(acceptTypedNumber(8, { min: 8, max: 64 })).toBe(8);
    expect(acceptTypedNumber(64, { min: 8, max: 64 })).toBe(64);
    expect(acceptTypedNumber(0, { min: 0, max: 3650 })).toBe(0);
  });
});

describe("numberFieldError", () => {
  it("names the range for an empty or out-of-range value", () => {
    expect(numberFieldError("", 8, 64)).toBe("Enter a number from 8 to 64");
    expect(numberFieldError(7, 8, 64)).toBe("Enter a number from 8 to 64");
    expect(numberFieldError(65, 8, 64)).toBe("Enter a number from 8 to 64");
    expect(numberFieldError(12, 8, 64)).toBeNull();
  });
  it("allows an empty value only when asked", () => {
    expect(numberFieldError("", 0, 168, true)).toBeNull();
    expect(numberFieldError(5, 1)).toBeNull();
    expect(numberFieldError(0, 1)).toBe("Enter 1 or more");
    expect(numberFieldError(9, undefined, 8)).toBe("Enter 8 or less");
  });
});
