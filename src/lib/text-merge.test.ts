import { describe, expect, it } from "vitest";
import { mergeText } from "./text-merge";

// Pen test 2026-11-28, V-33: two people editing one description at once.

const lines = (...l: string[]) => l.join("\n");

describe("mergeText", () => {
  it("keeps both people's edits to different lines", () => {
    const base = lines("Goal", "Step one", "Step two", "Notes");
    const mine = lines("Goal", "Step one, done by Friday", "Step two", "Notes");
    const theirs = lines("Goal", "Step one", "Step two", "Notes", "admin wrote this paragraph");
    expect(mergeText(base, mine, theirs)).toBe(lines("Goal", "Step one, done by Friday", "Step two", "Notes", "admin wrote this paragraph"));
  });

  it("is plain when only one side changed", () => {
    expect(mergeText("a", "a b", "a")).toBe("a b");
    expect(mergeText("a", "a", "a c")).toBe("a c");
    expect(mergeText("a", "same", "same")).toBe("same");
  });

  it("keeps both versions of a line both changed differently, theirs first", () => {
    const base = lines("one", "two", "three");
    expect(mergeText(base, lines("one", "TWO mine", "three"), lines("one", "two theirs", "three"))).toBe(lines("one", "two theirs", "TWO mine", "three"));
  });

  it("keeps a deletion on one side and an edit on the other", () => {
    const base = lines("intro", "old paragraph", "middle", "end");
    const mine = lines("intro", "middle", "end");
    const theirs = lines("intro", "old paragraph", "middle", "end, edited");
    expect(mergeText(base, mine, theirs)).toBe(lines("intro", "middle", "end, edited"));
  });

  it("takes the same change made on both sides once", () => {
    const base = lines("a", "b", "c");
    expect(mergeText(base, lines("a", "B", "c", "d"), lines("a", "B", "c"))).toBe(lines("a", "B", "c", "d"));
  });

  it("keeps two additions at the same place, theirs then mine", () => {
    expect(mergeText("top", lines("top", "manager text"), lines("top", "admin text"))).toBe(lines("top", "admin text", "manager text"));
    expect(mergeText("", "manager text", "admin wrote this paragraph")).toBe(lines("admin wrote this paragraph", "manager text"));
  });

  it("never drops their words when mine cleared the text", () => {
    const base = lines("a", "b");
    expect(mergeText(base, "", lines("a", "b", "c"))).toContain("c");
  });

  it("stays whole on a large text", () => {
    const base = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
    const mine = [...base];
    mine[10] = "mine at 10";
    const theirs = [...base];
    theirs[2900] = "theirs at 2900";
    const merged = mergeText(base.join("\n"), mine.join("\n"), theirs.join("\n")).split("\n");
    expect(merged).toHaveLength(3000);
    expect(merged[10]).toBe("mine at 10");
    expect(merged[2900]).toBe("theirs at 2900");
  });
});
