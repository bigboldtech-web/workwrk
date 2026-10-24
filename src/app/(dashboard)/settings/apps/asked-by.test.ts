// Apps & modules > Requests > Connector requests: who asked, as one row
// hint (settings-cleanup Phase 2, B5). Fails on the code before Phase 2:
// the row printed every name joined by commas, in as many lines as it took.

import { describe, expect, it } from "vitest";
import { ASKED_BY_SHOWN, askedByHasMore, askedByLine } from "./asked-by";

describe("askedByLine", () => {
  it("names one, two or three people in plain words", () => {
    expect(askedByLine([], 0)).toBe("");
    expect(askedByLine(["Ana"], 1)).toBe("Ana");
    expect(askedByLine(["Ana", "Ben"], 2)).toBe("Ana and Ben");
    expect(askedByLine(["Ana", "Ben", "Chris"], 3)).toBe("Ana, Ben and Chris");
  });

  it("names the first three and counts the rest, from everyone who asked, not only the names sent", () => {
    expect(ASKED_BY_SHOWN).toBe(3);
    expect(askedByLine(["Ana", "Ben", "Chris", "Dee"], 4)).toBe("Ana, Ben, Chris and 1 more");
    // The route names at most ten people; the count says how many asked.
    expect(askedByLine(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], 14)).toBe("A, B, C and 11 more");
    expect(askedByLine(["Ana", "Ben"], 5)).toBe("Ana, Ben and 3 more");
  });

  it("has a Show more only when it holds something the hint leaves out", () => {
    expect(askedByHasMore(["Ana", "Ben", "Chris"], 3, 0)).toBe(false);
    expect(askedByHasMore(["Ana", "Ben", "Chris", "Dee"], 4, 0)).toBe(true);
    expect(askedByHasMore(["Ana"], 1, 1)).toBe(true);
    expect(askedByHasMore(["Ana", "Ben"], 5, 0)).toBe(true);
  });
});
