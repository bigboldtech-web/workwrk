// The consent record's id (src/lib/compliance/consent-id.ts): the cookie's
// own random id, recovered from a cookie the old route nested into itself.

import { describe, expect, it } from "vitest";
import { consentIdOf } from "./consent-id";

const ID = "3f1c2a9e-8b7d-4c6e-9a5f-1e2d3c4b5a69";
const cookie = (t: string, v = "2026-04-18") => JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, doNotSell: false, v, t, ts: 1759700000000 });

describe("consentIdOf", () => {
  it("reads the id a cookie holds", () => {
    expect(consentIdOf(cookie(ID))).toBe(ID);
    expect(consentIdOf(ID)).toBe(ID);
  });

  it("recovers the first id from a cookie the old route nested on each re-prompt", () => {
    // Before: each re-prompt wrote the whole previous cookie back as "t".
    const nested = cookie(cookie(cookie(ID), "2026-10-05"), "2026-10-06");
    expect(consentIdOf(nested)).toBe(ID);
  });

  it("holds no id for no cookie, a broken one, or one without a random id", () => {
    for (const raw of [undefined, null, "", "not json", "{}", JSON.stringify({ t: 42 }), cookie("not-an-id"), "[]", "null"]) {
      expect(consentIdOf(raw)).toBeNull();
    }
  });
});
