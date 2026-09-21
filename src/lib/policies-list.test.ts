import { describe, expect, it } from "vitest";
import {
  POLICIES_VIEWS,
  POLICY_VIEW_NOTICE,
  allowedPolicyViews,
  defaultSortDir,
  myAckState,
  needsMyAck,
  parsePoliciesGroup,
  parsePoliciesSort,
  resolvePolicyView,
  statusesForView,
} from "./policies-list";

describe("allowedPolicyViews", () => {
  it("hides Drafts and Archived from a Member", () => {
    expect(allowedPolicyViews(false)).toEqual(["all", "needs-ack", "published"]);
    expect(allowedPolicyViews(true)).toEqual([...POLICIES_VIEWS]);
  });
});

describe("resolvePolicyView (shape 2)", () => {
  it("renders All with the notice when a Member pastes drafts or archived", () => {
    expect(resolvePolicyView("drafts", false)).toEqual({ view: "all", strip: true, notice: POLICY_VIEW_NOTICE });
    expect(resolvePolicyView("archived", false)).toEqual({ view: "all", strip: true, notice: POLICY_VIEW_NOTICE });
  });
  it("keeps the view for a FULL viewer", () => {
    expect(resolvePolicyView("drafts", true)).toEqual({ view: "drafts", strip: false, notice: null });
  });
  it("falls back silently on an unknown value and on none", () => {
    expect(resolvePolicyView("bogus", false)).toEqual({ view: "all", strip: true, notice: null });
    expect(resolvePolicyView(null, false)).toEqual({ view: "all", strip: false, notice: null });
  });
});

describe("statusesForView", () => {
  it("never lets a Member reach an unpublished row", () => {
    expect(statusesForView("all", false)).toEqual(["PUBLISHED"]);
    expect(statusesForView("drafts", false)).toEqual(["PUBLISHED"]);
  });
  it("opens drafts and archived to a FULL viewer", () => {
    expect(statusesForView("all", true)).toEqual(["DRAFT", "PUBLISHED", "ARCHIVED"]);
    expect(statusesForView("drafts", true)).toEqual(["DRAFT"]);
    expect(statusesForView("archived", true)).toEqual(["ARCHIVED"]);
  });
});

describe("sorts and groups", () => {
  it("defaults", () => {
    expect(parsePoliciesSort(null)).toBe("updated");
    expect(parsePoliciesSort("name")).toBe("name");
    expect(defaultSortDir("name")).toBe("asc");
    expect(defaultSortDir("updated")).toBe("desc");
    expect(parsePoliciesGroup(null)).toBe("category");
    expect(parsePoliciesGroup("none")).toBe("none");
  });
});

describe("myAckState / needsMyAck", () => {
  const base = { requiresAck: true, status: "PUBLISHED" as const, assigned: false, acknowledged: false };
  it("is not required for a draft or a policy that needs no acknowledgement", () => {
    expect(myAckState({ ...base, status: "DRAFT" })).toEqual({ required: false });
    expect(myAckState({ ...base, requiresAck: false })).toEqual({ required: false });
    expect(needsMyAck({ ...base, requiresAck: false })).toBe(false);
  });
  it("walks Assigned then Acknowledged", () => {
    expect(myAckState(base)).toEqual({ required: true, done: 0 });
    expect(myAckState({ ...base, assigned: true })).toEqual({ required: true, done: 1 });
    expect(myAckState({ ...base, assigned: true, acknowledged: true })).toEqual({ required: true, done: 2 });
    expect(needsMyAck(base)).toBe(true);
    expect(needsMyAck({ ...base, acknowledged: true })).toBe(false);
  });
  it("is not required of someone outside a named audience", () => {
    expect(myAckState({ ...base, hasAudience: true })).toEqual({ required: false });
    expect(needsMyAck({ ...base, hasAudience: true })).toBe(false);
    expect(needsMyAck({ ...base, hasAudience: true, assigned: true })).toBe(true);
    expect(needsMyAck({ ...base, hasAudience: false })).toBe(true);
  });
});
