import { describe, expect, it } from "vitest";
import { TALK_TEAMMATE_LIMITS, addressedIn, talkAddressRefusal, teammateRequestState } from "./talk-address";

const member = { orgRole: "MEMBER" };
const ok = { isMember: true, hasGuests: false };

describe("talkAddressRefusal", () => {
  it("lets a member ask in a direct message, a group and a private channel", () => {
    expect(talkAddressRefusal({ type: "DM", restricted: false, archivedAt: null }, member, ok)).toBeNull();
    expect(talkAddressRefusal({ type: "GROUP", restricted: false, archivedAt: null }, member, ok)).toBeNull();
    expect(talkAddressRefusal({ type: "CHANNEL", restricted: true, archivedAt: null }, member, ok)).toBeNull();
  });
  it("refuses, in order, a Guest, an archived one, a public channel, a non-member and Guests present", () => {
    expect(talkAddressRefusal({ type: "DM", restricted: false, archivedAt: null }, { orgRole: "GUEST" }, ok)).toBe("guest");
    expect(talkAddressRefusal({ type: "CHANNEL", restricted: false, archivedAt: new Date() }, member, ok)).toBe("archived");
    expect(talkAddressRefusal({ type: "CHANNEL", restricted: false, archivedAt: null }, member, ok)).toBe("public_channel");
    expect(talkAddressRefusal({ type: "CHANNEL", restricted: true, archivedAt: null }, member, { isMember: false, hasGuests: false })).toBe("not_member");
    expect(talkAddressRefusal({ type: "GROUP", restricted: false, archivedAt: null }, member, { isMember: true, hasGuests: true })).toBe("has_guests");
    expect(talkAddressRefusal({ type: "SOMETHING", restricted: true, archivedAt: null }, member, ok)).toBe("public_channel");
  });
});

describe("addressedIn", () => {
  it("needs the whole name after an @ at a word's start", () => {
    expect(addressedIn("@Chief of Staff, sum up", "Chief of Staff")).toBe(true);
    expect(addressedIn("hey @chief of staff sum up", "Chief of Staff")).toBe(true);
    expect(addressedIn("@Chief of Staffer sum up", "Chief of Staff")).toBe(false);
    expect(addressedIn("mail bob@Chief of Staff", "Chief of Staff")).toBe(false);
    expect(addressedIn("@Chief of Staffer and @Chief of Staff", "Chief of Staff")).toBe(true);
    expect(addressedIn("no mention", "Chief of Staff")).toBe(false);
    expect(addressedIn("@", "")).toBe(false);
  });
});

describe("teammateRequestState", () => {
  const at = "2026-10-07T10:00:00.000Z";
  const t0 = new Date(at).getTime();
  it("reads the stored state, and a running one past ten minutes as stale", () => {
    expect(teammateRequestState({ teammate: { state: "running" } }, at, t0 + 60_000)).toBe("running");
    expect(teammateRequestState({ teammate: { state: "running" } }, at, t0 + TALK_TEAMMATE_LIMITS.workingStaleMs + 1)).toBe("stale");
    expect(teammateRequestState({ teammate: { state: "answered" } }, at, t0)).toBe("answered");
    expect(teammateRequestState({ teammate: { state: "no_answer" } }, at, t0)).toBe("no_answer");
    expect(teammateRequestState({ teammate: { state: "weird" } }, at, t0)).toBeNull();
    expect(teammateRequestState({}, at, t0)).toBeNull();
    expect(teammateRequestState(null, at, t0)).toBeNull();
  });
});
