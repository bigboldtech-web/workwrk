import { describe, expect, it } from "vitest";
import { orgPublicLinksAllowed } from "./public-links";

describe("orgPublicLinksAllowed (toggle 10 as the public table and form routes read it)", () => {
  it("keeps today's behaviour when the org never stored the key", () => {
    expect(orgPublicLinksAllowed(null)).toBe(true);
    expect(orgPublicLinksAllowed({})).toBe(true);
    expect(orgPublicLinksAllowed({ access: {} })).toBe(true);
    expect(orgPublicLinksAllowed("junk")).toBe(true);
  });
  it("closes every link on an explicit off", () => {
    expect(orgPublicLinksAllowed({ access: { publicLinks: "off" } })).toBe(false);
  });
  it("allows view only", () => {
    expect(orgPublicLinksAllowed({ access: { publicLinks: "view" } })).toBe(true);
  });
});
