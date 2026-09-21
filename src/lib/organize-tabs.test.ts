import { describe, expect, it } from "vitest";
import { ORGANIZE_TABS, ORGANIZE_TAB_NOTICE, allowedOrganizeTabs, resolveOrganizeTab } from "./organize-tabs";

const admin = { manageProcess: true, manageSops: true };
const manager = { manageProcess: false, manageSops: true };
const member = { manageProcess: false, manageSops: false };

describe("allowedOrganizeTabs", () => {
  it("gives admins and the People team every tab, managers the two SOP tabs, members none", () => {
    expect(allowedOrganizeTabs(admin)).toEqual([...ORGANIZE_TABS]);
    expect(allowedOrganizeTabs(manager)).toEqual(["sop-folders", "tags"]);
    expect(allowedOrganizeTabs(member)).toEqual([]);
  });
});

describe("resolveOrganizeTab (the ?tab= contract)", () => {
  it("defaults to SOP folders with nothing and with an unknown value, silently", () => {
    expect(resolveOrganizeTab(null, admin)).toEqual({ tab: "sop-folders", strip: false, notice: null });
    expect(resolveOrganizeTab("bogus", admin)).toEqual({ tab: "sop-folders", strip: true, notice: null });
  });
  it("keeps a tab the viewer holds", () => {
    expect(resolveOrganizeTab("defaults", admin)).toEqual({ tab: "defaults", strip: false, notice: null });
    expect(resolveOrganizeTab("tags", manager)).toEqual({ tab: "tags", strip: false, notice: null });
  });
  it("renders SOP folders with the notice for a known tab the viewer cannot hold (shape 2)", () => {
    expect(resolveOrganizeTab("defaults", manager)).toEqual({ tab: "sop-folders", strip: true, notice: ORGANIZE_TAB_NOTICE });
    expect(resolveOrganizeTab("policy-categories", manager).notice).toBe(ORGANIZE_TAB_NOTICE);
  });
});
