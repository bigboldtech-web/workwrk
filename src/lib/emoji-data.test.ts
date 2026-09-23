import { describe, expect, it } from "vitest";
import {
  ALL_EMOJI,
  EMOJI_CATEGORIES,
  parseRecent,
  pushRecent,
  QUICK_REACTIONS,
  REACTION_EMOJI,
  searchEmoji,
} from "./emoji-data";

describe("the embedded list", () => {
  it("has the eight categories the spec names, each with content", () => {
    expect(EMOJI_CATEGORIES).toHaveLength(8);
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emoji.length).toBeGreaterThan(20);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("holds no duplicate characters, so the grid never shows one twice", () => {
    const seen = new Set<string>();
    for (const entry of ALL_EMOJI) {
      expect(seen.has(entry.e), `${entry.e} appears twice`).toBe(false);
      seen.add(entry.e);
    }
  });

  it("gives every emoji at least one lowercase search word", () => {
    for (const entry of ALL_EMOJI) {
      expect(entry.k.trim().length).toBeGreaterThan(0);
      expect(entry.k).toBe(entry.k.toLowerCase());
    }
  });

  it("CAN PRODUCE EVERY EMOJI THE REACTION ENDPOINT ACCEPTS", () => {
    // The pre-Phase-4 bug in one assertion: the server allowlist accepted
    // clap and no client surface could send it.
    const all = new Set(ALL_EMOJI.map((e) => e.e));
    for (const r of REACTION_EMOJI) expect(all.has(r), `picker cannot produce ${r}`).toBe(true);
    for (const q of QUICK_REACTIONS) expect(REACTION_EMOJI.includes(q)).toBe(true);
  });
});

describe("searchEmoji", () => {
  it("returns nothing for an empty query (the categories render instead)", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("prefers a word-prefix match over a substring match", () => {
    const hits = searchEmoji("car").map((x) => x.e);
    expect(hits).toContain("🚗");
    expect(hits).toContain("🥕");
    // "credit card" contains "car" only inside a word, so it comes after.
    expect(hits.indexOf("🚗")).toBeLessThan(hits.indexOf("💳"));
  });

  it("is case insensitive and trims", () => {
    expect(searchEmoji("  ROCKET ").map((x) => x.e)).toContain("🚀");
  });

  it("finds an emoji by a pasted character", () => {
    expect(searchEmoji("🎉")[0]?.e).toBe("🎉");
  });

  it("honours the limit", () => {
    expect(searchEmoji("a", 5)).toHaveLength(5);
  });

  it("answers nothing rather than throwing on a query that matches nothing", () => {
    expect(searchEmoji("zzzzqqq")).toEqual([]);
  });
});

describe("recents", () => {
  it("puts the newest first and de-duplicates", () => {
    expect(pushRecent(["👍", "🎉"], "🎉")).toEqual(["🎉", "👍"]);
    expect(pushRecent([], "👍")).toEqual(["👍"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => String(i));
    expect(pushRecent(many, "new", 5)).toEqual(["new", "0", "1", "2", "3"]);
  });

  it("parses stored junk into an empty list rather than throwing", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('["👍", 4, null, "🎉"]')).toEqual(["👍", "🎉"]);
  });

  it("drops an oversized entry, which is how a corrupted key gets in", () => {
    expect(parseRecent(`["${"x".repeat(200)}", "👍"]`)).toEqual(["👍"]);
  });
});
