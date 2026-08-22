import { describe, expect, it } from "vitest";
import { expectConflicts, jsonEqual } from "./sheet-conflict";

describe("jsonEqual: primitives", () => {
  it("equal primitives match", () => {
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual(0, 0)).toBe(true);
    expect(jsonEqual(-2.5, -2.5)).toBe(true);
    expect(jsonEqual("a", "a")).toBe(true);
    expect(jsonEqual("", "")).toBe(true);
    expect(jsonEqual(true, true)).toBe(true);
    expect(jsonEqual(false, false)).toBe(true);
  });

  it("different primitives of the same type conflict", () => {
    expect(jsonEqual(1, 2)).toBe(false);
    expect(jsonEqual("a", "b")).toBe(false);
    expect(jsonEqual(true, false)).toBe(false);
  });

  it("types matter: 1 vs \"1\" conflicts", () => {
    expect(jsonEqual(1, "1")).toBe(false);
    expect(jsonEqual("1", 1)).toBe(false);
  });

  it("types matter: boolean vs number/string conflicts", () => {
    expect(jsonEqual(true, 1)).toBe(false);
    expect(jsonEqual(false, 0)).toBe(false);
    expect(jsonEqual(true, "true")).toBe(false);
  });

  it("falsy values are NOT null: \"\" / 0 / false each conflict with null", () => {
    expect(jsonEqual("", null)).toBe(false);
    expect(jsonEqual(0, null)).toBe(false);
    expect(jsonEqual(false, null)).toBe(false);
  });
});

describe("jsonEqual: nullish collapse", () => {
  it("null equals null", () => {
    expect(jsonEqual(null, null)).toBe(true);
  });

  it("null equals undefined in both directions (absent key reads undefined)", () => {
    expect(jsonEqual(null, undefined)).toBe(true);
    expect(jsonEqual(undefined, null)).toBe(true);
    expect(jsonEqual(undefined, undefined)).toBe(true);
  });

  it("nullish never equals a real value", () => {
    expect(jsonEqual(null, "x")).toBe(false);
    expect(jsonEqual(undefined, 0)).toBe(false);
    expect(jsonEqual([], null)).toBe(false);
    expect(jsonEqual({}, null)).toBe(false);
  });
});

describe("jsonEqual: arrays (multi_select)", () => {
  it("equal arrays match", () => {
    expect(jsonEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(jsonEqual([], [])).toBe(true);
    expect(jsonEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
  });

  it("order is significant: a reorder is a real edit", () => {
    expect(jsonEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("length mismatch conflicts", () => {
    expect(jsonEqual(["a"], ["a", "b"])).toBe(false);
    expect(jsonEqual(["a", "b"], ["a"])).toBe(false);
    expect(jsonEqual([], [null])).toBe(false);
  });

  it("element types matter inside arrays", () => {
    expect(jsonEqual([1], ["1"])).toBe(false);
  });

  it("array never equals a non-array", () => {
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({}, [])).toBe(false);
    expect(jsonEqual(["a"], "a")).toBe(false);
  });
});

describe("jsonEqual: objects (formula cells)", () => {
  it("identical formula cells match", () => {
    expect(jsonEqual({ "=": "A1+B1" }, { "=": "A1+B1" })).toBe(true);
  });

  it("different formula source conflicts", () => {
    expect(jsonEqual({ "=": "A1+B1" }, { "=": "A1*B1" })).toBe(false);
  });

  it("key order does not cause a false conflict", () => {
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    // Round-tripped through JSON text in opposite key orders.
    expect(jsonEqual(JSON.parse('{"x":1,"y":[2]}'), JSON.parse('{"y":[2],"x":1}'))).toBe(true);
  });

  it("an extra key with a REAL value conflicts", () => {
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("a null-valued key equals an absent key (nullish collapse at depth)", () => {
    expect(jsonEqual({ a: 1, b: null }, { a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: null })).toBe(true);
  });

  it("nested structures compare deeply", () => {
    expect(jsonEqual({ a: { b: [1, { c: null }] } }, { a: { b: [1, {}] } })).toBe(true);
    expect(jsonEqual({ a: { b: [1] } }, { a: { b: [2] } })).toBe(false);
  });

  it("object vs primitive conflicts", () => {
    expect(jsonEqual({ "=": "A1" }, "A1")).toBe(false);
  });

  it("empty objects match", () => {
    expect(jsonEqual({}, {})).toBe(true);
  });
});

describe("expectConflicts", () => {
  const current = {
    name: "Widget",
    qty: 4,
    tags: ["red", "blue"],
    total: { "=": "B1*C1" },
    done: false,
  };

  it("returns [] when every expected cell still matches", () => {
    expect(
      expectConflicts(current, { name: "Widget", tags: ["red", "blue"], total: { "=": "B1*C1" } }),
    ).toEqual([]);
  });

  it("names exactly the mismatched colIds", () => {
    expect(expectConflicts(current, { name: "Gadget", qty: 4, done: true })).toEqual(
      ["name", "done"],
    );
  });

  it("checks ONLY the cols named in expect: other drift is not this cell's conflict", () => {
    expect(expectConflicts(current, { qty: 4 })).toEqual([]);
  });

  it("empty expect is always clean (today's unconditional merge)", () => {
    expect(expectConflicts(current, {})).toEqual([]);
  });

  it("expect null MATCHES an absent col (empty cell reads null client-side)", () => {
    expect(expectConflicts({ a: 1 }, { missing: null })).toEqual([]);
  });

  it("expect null also matches a stored explicit null", () => {
    expect(expectConflicts({ a: null }, { a: null })).toEqual([]);
  });

  it("expect of a REAL value against an absent col conflicts", () => {
    expect(expectConflicts({}, { a: "typed elsewhere" })).toEqual(["a"]);
  });

  it("stored value against expect null conflicts (someone filled the cell)", () => {
    expect(expectConflicts({ a: "now filled" }, { a: null })).toEqual(["a"]);
  });

  it("numeric 1 vs \"1\" CONFLICTS: type changes are surfaced", () => {
    expect(expectConflicts({ n: 1 }, { n: "1" })).toEqual(["n"]);
  });

  it("formula cell compared key-order-insensitively, source-sensitively", () => {
    expect(expectConflicts({ f: { "=": "SUM(A1:A3)" } }, { f: { "=": "SUM(A1:A3)" } })).toEqual([]);
    expect(expectConflicts({ f: { "=": "SUM(A1:A3)" } }, { f: { "=": "SUM(A1:A4)" } })).toEqual(["f"]);
  });

  it("multi_select reorder conflicts, identical order does not", () => {
    expect(expectConflicts({ t: ["a", "b"] }, { t: ["a", "b"] })).toEqual([]);
    expect(expectConflicts({ t: ["a", "b"] }, { t: ["b", "a"] })).toEqual(["t"]);
  });

  it("preserves expect-key iteration order in the returned colIds", () => {
    expect(expectConflicts({ a: 1, b: 2, c: 3 }, { c: 9, a: 9, b: 2 })).toEqual(["c", "a"]);
  });

  it("prototype names on current read as ABSENT, not as inherited functions", () => {
    // {} has toString/constructor via its prototype; a conflict check on a
    // column that happens to carry such a name must not see them.
    expect(expectConflicts({}, { toString: null })).toEqual([]);
    expect(expectConflicts({}, { constructor: { "=": "A1" } })).toEqual(["constructor"]);
  });

  it("a JSON.parse'd __proto__ column compares as an own key", () => {
    const cur = JSON.parse('{"__proto__": "v1"}') as Record<string, unknown>;
    const exp = JSON.parse('{"__proto__": "v1"}') as Record<string, unknown>;
    expect(expectConflicts(cur, exp)).toEqual([]);
    const expStale = JSON.parse('{"__proto__": "v0"}') as Record<string, unknown>;
    expect(expectConflicts(cur, expStale)).toEqual(["__proto__"]);
  });
});
