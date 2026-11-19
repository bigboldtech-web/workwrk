import { describe, expect, it } from "vitest";
import { asReadTitle, tabTitleFor } from "./tab-title";

describe("the tab title", () => {
  it("is what the browser reads back, so re-asserting it settles at once", () => {
    // "varsha " + " " + "shinde": the name a stray space made.
    const title = tabTitleFor("varsha  shinde");
    expect(title).toBe("varsha shinde · WorkwrK");
    expect(asReadTitle(title as string)).toBe(title);
  });

  it("strips and collapses every kind of ASCII whitespace, as the title getter does", () => {
    expect(asReadTitle("  a\t\tb\nc\r\fd  ")).toBe("a b c d");
  });

  it("keeps a no-break space, which the getter keeps too", () => {
    expect(asReadTitle("a b")).toBe("a b");
  });

  it("has no title for a page with no name", () => {
    expect(tabTitleFor(null)).toBeNull();
    expect(tabTitleFor("   ")).toBeNull();
  });

  it("guard: an ordinary name is unchanged", () => {
    expect(tabTitleFor("Inbox")).toBe("Inbox · WorkwrK");
  });
});
