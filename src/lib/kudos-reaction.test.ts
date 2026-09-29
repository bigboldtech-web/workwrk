import { describe, expect, it } from "vitest";
import { parseReactionRequest, reactionWrite } from "./kudos-reaction";

describe("reactionWrite", () => {
  it("an explicit state writes only when it is not already true", () => {
    expect(reactionWrite(false, true)).toBe("create");
    expect(reactionWrite(true, true)).toBe("none");
    expect(reactionWrite(true, false)).toBe("delete");
    expect(reactionWrite(false, false)).toBe("none");
  });

  it("no state (an older client) toggles", () => {
    expect(reactionWrite(false, null)).toBe("create");
    expect(reactionWrite(true, null)).toBe("delete");
  });
});

describe("parseReactionRequest", () => {
  it("reads the emoji and the wanted state", () => {
    expect(parseReactionRequest({ emoji: " 🔥 ", on: true })).toEqual({ ok: true, emoji: "🔥", on: true });
    expect(parseReactionRequest({ emoji: "🔥", on: false })).toEqual({ ok: true, emoji: "🔥", on: false });
  });

  it("reads a missing or null state as the old toggle", () => {
    expect(parseReactionRequest({ emoji: "🔥" })).toEqual({ ok: true, emoji: "🔥", on: null });
    expect(parseReactionRequest({ emoji: "🔥", on: null })).toEqual({ ok: true, emoji: "🔥", on: null });
  });

  it("refuses a state that is not a boolean, and any emoji outside the picker", () => {
    expect(parseReactionRequest({ emoji: "🔥", on: "true" }).ok).toBe(false);
    expect(parseReactionRequest({ emoji: "🔥", on: 0 }).ok).toBe(false);
    expect(parseReactionRequest({ emoji: "😀", on: true }).ok).toBe(false);
    expect(parseReactionRequest(null).ok).toBe(false);
  });
});
