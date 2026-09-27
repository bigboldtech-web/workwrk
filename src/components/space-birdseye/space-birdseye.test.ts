// The overview's error hint: the route's catch-all 500 sends the very
// sentence ErrorState builds as its title, and the hint line under it must
// never print that sentence a second time.

import { describe, expect, it } from "vitest";
import { OVERVIEW_ERROR_FALLBACK_HINT, OVERVIEW_ERROR_WHAT, overviewErrorHint } from "./space-birdseye";

describe("overviewErrorHint", () => {
  const title = `Couldn't load ${OVERVIEW_ERROR_WHAT}`;

  it("never repeats the title the route's 500 body restates", () => {
    // The exact body of src/app/api/spaces/[id]/birdseye/route.ts's catch.
    const hint = overviewErrorHint("Couldn't load the bird's eye view.");
    expect(hint).toBe(OVERVIEW_ERROR_FALLBACK_HINT);
    expect(hint.toLowerCase()).not.toContain(title.toLowerCase());
  });

  it("treats case, trailing punctuation, spaces and curly apostrophes as the same words", () => {
    for (const m of [title, `${title}.`, ` ${title.toUpperCase()}!  `, "Couldn’t load the bird’s eye view."]) {
      expect(overviewErrorHint(m)).toBe(OVERVIEW_ERROR_FALLBACK_HINT);
    }
  });

  it("says something useful when there is no message at all", () => {
    expect(overviewErrorHint(null)).toBe(OVERVIEW_ERROR_FALLBACK_HINT);
    expect(overviewErrorHint(undefined)).toBe(OVERVIEW_ERROR_FALLBACK_HINT);
    expect(overviewErrorHint("   ")).toBe(OVERVIEW_ERROR_FALLBACK_HINT);
  });

  it("keeps a message that adds something", () => {
    expect(overviewErrorHint("You're offline")).toBe("You're offline");
    expect(overviewErrorHint("Your session has expired")).toBe("Your session has expired");
    expect(overviewErrorHint("You don't have access to this")).toBe("You don't have access to this");
  });

  it("the fallback line is new words, not the title again", () => {
    expect(OVERVIEW_ERROR_FALLBACK_HINT.toLowerCase()).not.toContain("couldn't load");
  });
});
