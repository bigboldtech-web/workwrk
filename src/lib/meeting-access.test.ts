import { describe, expect, it } from "vitest";
import { canDeleteMeeting, canEditMeeting, canReadMeeting, meetingRole } from "./meeting-access";

const base = { viewerId: "u1", isOrgAdmin: false, createdById: "u9", attendeeIds: [] as string[] };

describe("meetingRole", () => {
  it("gives the creator Full access", () => {
    expect(meetingRole({ ...base, createdById: "u1" })).toBe("full");
  });

  it("gives an Owner or Admin Full access even when they do not attend", () => {
    expect(meetingRole({ ...base, isOrgAdmin: true })).toBe("full");
  });

  it("gives an attendee Can edit", () => {
    expect(meetingRole({ ...base, attendeeIds: ["u2", "u1"] })).toBe("edit");
  });

  it("gives everyone else none", () => {
    expect(meetingRole({ ...base, attendeeIds: ["u2"] })).toBe("none");
  });

  it("prefers the creator role over the attendee role", () => {
    expect(meetingRole({ ...base, createdById: "u1", attendeeIds: ["u1"] })).toBe("full");
  });

  it("resolves a historical row with no creator on attendance alone", () => {
    expect(meetingRole({ ...base, createdById: null, attendeeIds: ["u1"] })).toBe("edit");
    expect(meetingRole({ ...base, createdById: undefined, attendeeIds: ["u1"] })).toBe("edit");
    expect(meetingRole({ ...base, createdById: null, attendeeIds: [] })).toBe("none");
    // An admin still reaches a historical row.
    expect(meetingRole({ ...base, createdById: null, isOrgAdmin: true })).toBe("full");
  });

  it("never grants a role to an empty viewer", () => {
    expect(meetingRole({ ...base, viewerId: "", isOrgAdmin: true })).toBe("none");
    expect(meetingRole({ viewerId: "", isOrgAdmin: false, createdById: "", attendeeIds: [""] })).toBe("none");
  });
});

describe("the three questions the routes ask", () => {
  it("read is creator, admin or attendee", () => {
    expect(canReadMeeting({ ...base, createdById: "u1" })).toBe(true);
    expect(canReadMeeting({ ...base, isOrgAdmin: true })).toBe(true);
    expect(canReadMeeting({ ...base, attendeeIds: ["u1"] })).toBe(true);
    expect(canReadMeeting(base)).toBe(false);
  });

  it("edit is everyone who can read", () => {
    expect(canEditMeeting({ ...base, attendeeIds: ["u1"] })).toBe(true);
    expect(canEditMeeting(base)).toBe(false);
  });

  it("delete is Full access only, so an attendee cannot take it from everyone", () => {
    expect(canDeleteMeeting({ ...base, attendeeIds: ["u1"] })).toBe(false);
    expect(canDeleteMeeting({ ...base, createdById: "u1" })).toBe(true);
    expect(canDeleteMeeting({ ...base, isOrgAdmin: true })).toBe(true);
  });
});
