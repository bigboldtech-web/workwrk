import { describe, expect, it } from "vitest";
import { orgPublicLinksAllowed, orgPublicLinksTurnedOn } from "./public-links";

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

describe("orgPublicLinksTurnedOn (a kind of link newer than the switch: tasks)", () => {
  it("is on only when an admin turned the switch to view", () => {
    expect(orgPublicLinksTurnedOn({ access: { publicLinks: "view" } })).toBe(true);
  });
  it("is off when the switch was never set, as Settings shows it", () => {
    expect(orgPublicLinksTurnedOn(null)).toBe(false);
    expect(orgPublicLinksTurnedOn({})).toBe(false);
    expect(orgPublicLinksTurnedOn({ access: {} })).toBe(false);
    expect(orgPublicLinksTurnedOn("junk")).toBe(false);
    expect(orgPublicLinksTurnedOn({ access: { publicLinks: "off" } })).toBe(false);
    expect(orgPublicLinksTurnedOn({ access: { publicLinks: "edit" } })).toBe(false);
  });
});
