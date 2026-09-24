import { describe, expect, it } from "vitest";
import { formContentRev, patchAllowed, stableStringify } from "./content-rev";

const base = {
  name: "Intake",
  description: null,
  fields: [{ id: "f1", type: "short_text", label: "Name", required: true }],
  targetBoardId: null,
  targetTableId: "t1",
  fieldMappings: { table: { f1: "c1" } },
  settings: { acceptResponses: true },
};

describe("stableStringify", () => {
  it("sorts object keys at every depth", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [ { z: 1, y: 2 } ] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });
  it("drops undefined members like JSON.stringify", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("formContentRev", () => {
  it("is the same for the same content read back in another key order (jsonb)", () => {
    const reordered = {
      settings: { acceptResponses: true },
      fieldMappings: { table: { f1: "c1" } },
      fields: [{ required: true, label: "Name", type: "short_text", id: "f1" }],
      targetTableId: "t1", targetBoardId: null, description: null, name: "Intake",
    };
    expect(formContentRev(reordered)).toBe(formContentRev(base));
  });
  it("ignores columns the builder does not write (isPublic, updatedAt)", () => {
    expect(formContentRev({ ...base, isPublic: true, updatedAt: new Date() } as typeof base)).toBe(formContentRev(base));
  });
  it("changes when a field is added elsewhere", () => {
    const more = { ...base, fields: [...base.fields, { id: "f2", type: "rating", label: "Score" }] };
    expect(formContentRev(more)).not.toBe(formContentRev(base));
  });
  it("reads an absent settings column the same as null", () => {
    const { settings: _s, ...noSettings } = base;
    void _s;
    expect(formContentRev(noSettings)).toBe(formContentRev({ ...base, settings: null }));
  });
});

describe("patchAllowed", () => {
  it("lets a caller without expectRev write as before", () => {
    expect(patchAllowed({ expectRev: null, storedRev: "a", nextRev: "b" })).toBe(true);
  });
  it("lets a save based on the stored copy write", () => {
    expect(patchAllowed({ expectRev: "a", storedRev: "a", nextRev: "b" })).toBe(true);
  });
  it("refuses a save based on an older copy (a second tab)", () => {
    expect(patchAllowed({ expectRev: "old", storedRev: "a", nextRev: "b" })).toBe(false);
  });
  it("accepts a retry whose first attempt already landed", () => {
    expect(patchAllowed({ expectRev: "old", storedRev: "b", nextRev: "b" })).toBe(true);
  });
});
