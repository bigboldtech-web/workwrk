import { describe, expect, it } from "vitest";
import {
  allowedAudienceKinds,
  canCreateAnnouncement,
  canDeleteAnnouncement,
  canEditAnnouncement,
  canOpenAnnouncements,
  canReadAnyAnnouncement,
  canSeeAckRoster,
  isOrgAdminRole,
  type AnnouncementViewerFacts,
} from "./announcement-access";

const post = { authorId: "anita", organizationId: "org1" };

function viewer(over: Partial<AnnouncementViewerFacts> = {}): AnnouncementViewerFacts {
  return { userId: "raj", orgRole: "MEMBER", canCreate: false, ...over };
}

describe("isOrgAdminRole", () => {
  it("is Owner and Admin only", () => {
    expect(isOrgAdminRole("OWNER")).toBe(true);
    expect(isOrgAdminRole("ADMIN")).toBe(true);
    expect(isOrgAdminRole("MEMBER")).toBe(false);
    expect(isOrgAdminRole("GUEST")).toBe(false);
    expect(isOrgAdminRole("AGENT")).toBe(false);
  });
});

describe("canOpenAnnouncements", () => {
  it("lets every Member in and keeps every Guest out", () => {
    expect(canOpenAnnouncements({ orgRole: "MEMBER" })).toBe(true);
    expect(canOpenAnnouncements({ orgRole: "AGENT" })).toBe(true);
    expect(canOpenAnnouncements({ orgRole: "GUEST" })).toBe(false);
  });
});

describe("canReadAnyAnnouncement (the oversight read)", () => {
  it("is Owner, Admin and the People team", () => {
    expect(canReadAnyAnnouncement(viewer({ orgRole: "OWNER" }))).toBe(true);
    expect(canReadAnyAnnouncement(viewer({ orgRole: "ADMIN" }))).toBe(true);
    expect(canReadAnyAnnouncement(viewer({ canCreate: true }))).toBe(true);
  });
  it("is NOT an ordinary Member, even one with reports", () => {
    // The behaviour change: "manager" used to mean "reads every post".
    expect(canReadAnyAnnouncement(viewer())).toBe(false);
  });
  it("is never a Guest", () => {
    expect(canReadAnyAnnouncement(viewer({ orgRole: "GUEST", canCreate: true }))).toBe(false);
  });
});

describe("canEditAnnouncement", () => {
  it("is the author", () => {
    expect(canEditAnnouncement(post, viewer({ userId: "anita" }))).toBe(true);
  });
  it("is an Owner or Admin who did not write it", () => {
    expect(canEditAnnouncement(post, viewer({ orgRole: "ADMIN" }))).toBe(true);
  });
  it("is not somebody else, even with create rights", () => {
    expect(canEditAnnouncement(post, viewer({ canCreate: true }))).toBe(false);
  });
  it("is never a Guest, even the author", () => {
    expect(canEditAnnouncement(post, viewer({ userId: "anita", orgRole: "GUEST" }))).toBe(false);
  });
  it("does not match an authorless post to an authorless viewer", () => {
    expect(canEditAnnouncement({ authorId: null, organizationId: "org1" }, viewer({ userId: "" }))).toBe(false);
  });
  it("delete and the ack roster follow the same rule", () => {
    expect(canDeleteAnnouncement(post, viewer({ userId: "anita" }))).toBe(true);
    expect(canSeeAckRoster(post, viewer({ userId: "anita" }))).toBe(true);
    expect(canDeleteAnnouncement(post, viewer())).toBe(false);
    expect(canSeeAckRoster(post, viewer())).toBe(false);
  });
});

describe("canCreateAnnouncement", () => {
  it("is Owner, Admin, the People team, or a Space Full holder", () => {
    expect(canCreateAnnouncement(viewer({ orgRole: "OWNER" }))).toBe(true);
    expect(canCreateAnnouncement(viewer({ canCreate: true }))).toBe(true);
    expect(canCreateAnnouncement(viewer(), true)).toBe(true);
  });
  it("is not a plain Member", () => {
    expect(canCreateAnnouncement(viewer())).toBe(false);
  });
  it("is never a Guest", () => {
    expect(canCreateAnnouncement(viewer({ orgRole: "GUEST", canCreate: true }), true)).toBe(false);
  });
});

describe("allowedAudienceKinds", () => {
  it("gives the org kinds to Owners, Admins and the People team", () => {
    expect(allowedAudienceKinds(viewer({ orgRole: "ADMIN" }), false)).toContain("ALL");
    expect(allowedAudienceKinds(viewer({ canCreate: true }), false)).toContain("TAGS");
  });
  it("gives a Space Full holder SPACE and nothing else", () => {
    expect(allowedAudienceKinds(viewer(), true)).toEqual(["SPACE"]);
  });
  it("gives a plain Member nothing", () => {
    expect(allowedAudienceKinds(viewer(), false)).toEqual([]);
  });
});
