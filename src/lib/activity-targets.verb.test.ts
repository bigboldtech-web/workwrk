// The Activity row never says the verb twice, and never shows an em dash.
//
// The row prints "<Actor> <verb> <tail>", where the verb comes from the
// stored `type` and the tail from the stored `description`. Writers store a
// whole SENTENCE in `description`, and a sentence begins with its own action,
// so the row read: Verify Bot applied Applied "Engineering team" template.
// The guard was exact equality, which caught "signed in" and nothing else.

import { describe, it, expect } from "vitest";
import { withoutLeadingVerb } from "./activity-targets";

describe("withoutLeadingVerb", () => {
  it("drops a tail that is only the verb", () => {
    expect(withoutLeadingVerb("signed in", "signed in")).toBeNull();
    expect(withoutLeadingVerb("Signed In", "signed in")).toBeNull();
  });

  it("drops the verb from the FRONT of a longer sentence", () => {
    expect(withoutLeadingVerb('Applied "Engineering team" template', "applied")).toBe(
      '"Engineering team" template',
    );
    expect(withoutLeadingVerb("Created task X", "created")).toBe("task X");
  });

  it("handles a multi-word verb", () => {
    expect(withoutLeadingVerb("Commented on the release notes", "commented on")).toBe(
      "the release notes",
    );
  });

  it("keeps a sentence that does not start with the verb", () => {
    expect(withoutLeadingVerb("Two files attached", "created")).toBe("Two files attached");
  });

  it("never lets the verb match a longer word that merely starts with it", () => {
    // "app" must not eat the front of "Applied ...".
    expect(withoutLeadingVerb("Applied a template", "app")).toBe("Applied a template");
  });

  it("removes em dashes and double hyphens from what a person reads", () => {
    expect(withoutLeadingVerb('Applied "HR team" template — seeded a doc', "applied")).toBe(
      '"HR team" template, seeded a doc',
    );
    expect(withoutLeadingVerb("Renamed it -- twice", "renamed")).toBe("it, twice");
  });

  it("answers null for nothing rather than an empty string", () => {
    expect(withoutLeadingVerb(null, "created")).toBeNull();
    expect(withoutLeadingVerb("   ", "created")).toBeNull();
    expect(withoutLeadingVerb("Created", "created")).toBeNull();
  });
});
