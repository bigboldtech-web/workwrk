import { describe, expect, it } from "vitest";
import { draftKey, isDraftNewer, parseDraft, serializeDraft } from "./local-draft";

describe("local draft envelope", () => {
  it("keys by kind and id under one prefix", () => {
    expect(draftKey("doc", "abc")).toBe("workwrk:draft:doc:abc");
    expect(draftKey("canvas", "x1")).toBe("workwrk:draft:canvas:x1");
  });

  it("round-trips a payload with its write time", () => {
    const raw = serializeDraft({ title: "T", blocks: [1, 2] }, new Date("2026-09-21T10:00:00Z"));
    const env = parseDraft<{ title: string; blocks: number[] }>(raw);
    expect(env).toEqual({ at: "2026-09-21T10:00:00.000Z", payload: { title: "T", blocks: [1, 2] } });
  });

  it("rejects garbage, missing fields and a bad timestamp", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ payload: 1 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ at: "yesterday", payload: 1 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ at: "2026-09-21T10:00:00Z" }))).toBeNull();
  });

  it("offers a draft only when it is newer than the server row", () => {
    const env = { at: "2026-09-21T10:00:00Z", payload: {} };
    expect(isDraftNewer(env, "2026-09-21T09:59:59Z")).toBe(true);
    expect(isDraftNewer(env, "2026-09-21T10:00:00Z")).toBe(false);
    expect(isDraftNewer(env, new Date("2026-09-21T10:00:01Z"))).toBe(false);
    // A server row with no usable timestamp cannot outrank the draft.
    expect(isDraftNewer(env, "never")).toBe(true);
  });
});
