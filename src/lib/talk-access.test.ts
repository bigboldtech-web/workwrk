import { describe, expect, it } from "vitest";
import {
  atLeast,
  canAddPeople,
  canArchive,
  canCall,
  canLeave,
  canManageMembers,
  canPost,
  canReact,
  canRename,
  canResetGuestLink,
  canSelfJoin,
  isArchived,
  isGeneralChannel,
  readOnlyReason,
  talkRole,
  type TalkConversationFacts,
  type TalkViewerFacts,
} from "./talk-access";

const ME = "u-me";
const OTHER = "u-other";

function channel(over: Partial<TalkConversationFacts> = {}): TalkConversationFacts {
  return { type: "CHANNEL", name: "sales", createdById: OTHER, restricted: false, archivedAt: null, ...over };
}
function viewer(over: Partial<TalkViewerFacts> = {}): TalkViewerFacts {
  return { userId: ME, orgRole: "MEMBER", isMember: true, ...over };
}

describe("talkRole", () => {
  it("gives a member of a public channel edit, and its creator full", () => {
    expect(talkRole(channel(), viewer())).toBe("edit");
    expect(talkRole(channel({ createdById: ME }), viewer())).toBe("full");
  });

  it("gives Owners and Admins full on a public channel even before they join", () => {
    expect(talkRole(channel(), viewer({ orgRole: "ADMIN", isMember: false }))).toBe("full");
    expect(talkRole(channel(), viewer({ orgRole: "OWNER", isMember: false }))).toBe("full");
  });

  it("gives an Admin NOTHING on a private channel they are not in (rule 3, no read-around)", () => {
    const priv = channel({ restricted: true });
    expect(talkRole(priv, viewer({ orgRole: "ADMIN", isMember: false }))).toBe("none");
    expect(talkRole(priv, viewer({ orgRole: "OWNER", isMember: false }))).toBe("none");
    // In it, they are an ordinary member; its creator still holds Full.
    expect(talkRole(priv, viewer({ orgRole: "ADMIN", isMember: true }))).toBe("edit");
    expect(talkRole(priv, viewer({ createdById: undefined } as never))).toBeDefined();
    expect(talkRole(channel({ restricted: true, createdById: ME }), viewer())).toBe("full");
  });

  it("404s a non-member of a public channel at the role level (Join is decided separately)", () => {
    expect(talkRole(channel(), viewer({ isMember: false }))).toBe("none");
  });

  it("gives both sides of a DM edit and nobody full", () => {
    const dm: TalkConversationFacts = { type: "DM", name: null, createdById: ME, restricted: false, archivedAt: null };
    expect(talkRole(dm, viewer())).toBe("edit");
    expect(talkRole(dm, viewer({ userId: OTHER }))).toBe("edit");
    expect(talkRole(dm, viewer({ isMember: false }))).toBe("none");
    // Even an Owner gets nothing on somebody else's DM.
    expect(talkRole(dm, viewer({ orgRole: "OWNER", isMember: false }))).toBe("none");
  });

  it("gives a group's creator full and the rest edit, with no admin read-around", () => {
    const group: TalkConversationFacts = { type: "GROUP", name: "Launch", createdById: ME, restricted: false, archivedAt: null };
    expect(talkRole(group, viewer())).toBe("full");
    expect(talkRole(group, viewer({ userId: OTHER }))).toBe("edit");
    expect(talkRole(group, viewer({ orgRole: "ADMIN", isMember: false }))).toBe("none");
  });

  it("caps everyone at view when archived, and keeps Full for whoever can restore", () => {
    const archived = channel({ archivedAt: new Date("2026-09-01T00:00:00Z") });
    expect(talkRole(archived, viewer())).toBe("view");
    expect(talkRole(archived, viewer({ orgRole: "ADMIN" }))).toBe("full");
    expect(talkRole(archived, viewer({ isMember: false }))).toBe("none");
  });

  it("never hands a Guest Full", () => {
    expect(talkRole(channel({ createdById: ME }), viewer({ orgRole: "GUEST" }))).toBe("edit");
  });
});

describe("canSelfJoin", () => {
  const findable = { ...channel(), findable: true };
  it("is true for a Member opening a findable public channel", () => {
    expect(canSelfJoin(findable, viewer({ isMember: false }))).toBe(true);
  });
  it("is false once you are already in it", () => {
    expect(canSelfJoin(findable, viewer({ isMember: true }))).toBe(false);
  });
  it("is false for a hidden, private or archived channel, and for a Guest", () => {
    expect(canSelfJoin({ ...findable, findable: false }, viewer({ isMember: false }))).toBe(false);
    expect(canSelfJoin({ ...findable, restricted: true }, viewer({ isMember: false }))).toBe(false);
    expect(canSelfJoin({ ...findable, archivedAt: new Date() }, viewer({ isMember: false }))).toBe(false);
    expect(canSelfJoin(findable, viewer({ isMember: false, orgRole: "GUEST" }))).toBe(false);
  });
  it("is false for a DM or a group, whatever findable says", () => {
    expect(canSelfJoin({ ...findable, type: "DM" }, viewer({ isMember: false }))).toBe(false);
    expect(canSelfJoin({ ...findable, type: "GROUP" }, viewer({ isMember: false }))).toBe(false);
  });
});

describe("#general protections", () => {
  const general = channel({ name: "general", createdById: ME });
  const v = viewer();
  it("is recognised case-insensitively and only as a channel", () => {
    expect(isGeneralChannel({ type: "CHANNEL", name: "General" })).toBe(true);
    expect(isGeneralChannel({ type: "CHANNEL", name: " general " })).toBe(true);
    expect(isGeneralChannel({ type: "GROUP", name: "general" })).toBe(false);
    expect(isGeneralChannel({ type: "CHANNEL", name: null })).toBe(false);
  });
  it("cannot be left, renamed, restricted or archived, even by its creator", () => {
    const role = talkRole(general, v);
    expect(role).toBe("full");
    expect(canLeave(general, v)).toBe(false);
    expect(canRename(general, role)).toBe(false);
    expect(canArchive(general, role)).toBe(false);
  });
  it("can still be posted in, called in and added to", () => {
    const role = talkRole(general, v);
    expect(canPost(general, role)).toBe(true);
    expect(canCall(general, role)).toBe(true);
    expect(canAddPeople(general, role)).toBe(true);
  });
});

describe("the action helpers", () => {
  it("lets any member add people to a public channel but only Full to a private one or a group", () => {
    expect(canAddPeople(channel(), "edit")).toBe(true);
    expect(canAddPeople(channel({ restricted: true }), "edit")).toBe(false);
    expect(canAddPeople(channel({ restricted: true }), "full")).toBe(true);
    expect(canAddPeople({ type: "GROUP", name: "g", createdById: ME, restricted: false, archivedAt: null }, "edit")).toBe(false);
    expect(canAddPeople({ type: "DM", name: null, createdById: ME, restricted: false, archivedAt: null }, "full")).toBe(false);
  });

  it("closes every write on an archived conversation except restore-level acts", () => {
    const a = channel({ archivedAt: new Date() });
    expect(canPost(a, "full")).toBe(false);
    expect(canReact(a, "full")).toBe(false);
    expect(canCall(a, "full")).toBe(false);
    expect(canAddPeople(a, "full")).toBe(false);
    expect(canRename(a, "full")).toBe(false);
    expect(canManageMembers(a, "full")).toBe(false);
    expect(canResetGuestLink(a, "full")).toBe(false);
    // Archive/restore itself stays available, or nothing could ever come back.
    expect(canArchive(a, "full")).toBe(true);
  });

  it("ranks roles rather than string-comparing them", () => {
    expect(atLeast("full", "edit")).toBe(true);
    expect(atLeast("view", "comment")).toBe(false);
    expect(atLeast("comment", "comment")).toBe(true);
  });
});

describe("readOnlyReason", () => {
  it("names the owner on an archived conversation and says nothing to a writer", () => {
    expect(readOnlyReason(channel({ archivedAt: new Date() }), "view", "Anita Rao")).toBe("Archived. Ask Anita Rao to restore.");
    expect(readOnlyReason(channel({ archivedAt: new Date() }), "full", "Anita Rao")).toBe("Archived. Restore it to post again.");
    expect(readOnlyReason(channel(), "edit", null)).toBeNull();
    expect(readOnlyReason(channel(), "view", null)).toBe("View only.");
  });
  it("falls back to an admin when there is no owner to name", () => {
    expect(readOnlyReason(channel({ archivedAt: new Date() }), "view", null)).toBe("Archived. Ask a workspace admin to restore.");
  });
});

describe("isArchived", () => {
  it("accepts a Date, an ISO string or null", () => {
    expect(isArchived({ archivedAt: null })).toBe(false);
    expect(isArchived({ archivedAt: new Date() })).toBe(true);
    expect(isArchived({ archivedAt: "2026-09-01T00:00:00.000Z" })).toBe(true);
  });
});
