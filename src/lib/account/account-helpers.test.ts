import { describe, expect, it } from "vitest";
import { profileDirty, profileDraftOf, profilePatch } from "./profile-form";
import { presenceChoiceOf, presenceExpiryFor } from "./presence-choices";
import { activeMute, isMuteForever, mutedUntilFor, presetOf, presetValues } from "./notification-presets";
import { localeCookieFor, timeZoneOptions } from "./locale-options";
import { SECURITY_EVENT_LABEL } from "./security-events";
import { decodePresence, encodePresence } from "../people/presence-codec";
import { isLastAdminOf } from "../access/self-facts";
import { mutedObjectKeys, placeMuteKeys, MUTABLE_NOTIFY_TYPES } from "../notify-prefs";

describe("profile form", () => {
  const saved = profileDraftOf({ firstName: "Ada", lastName: "Lovelace", phone: null, dateOfBirth: "1990-05-01T12:00:00.000Z" });
  it("starts from the record", () => {
    expect(saved).toEqual({ firstName: "Ada", lastName: "Lovelace", phone: "", dateOfBirth: "1990-05-01" });
  });
  it("is not dirty over whitespace", () => {
    expect(profileDirty(saved, { ...saved, firstName: " Ada " })).toBe(false);
    expect(profileDirty(saved, { ...saved, phone: "123" })).toBe(true);
  });
  it("sends only what changed, in one body", () => {
    const p = profilePatch(saved, { ...saved, phone: " +44 1 ", dateOfBirth: "" });
    expect(p).toEqual({ ok: true, data: { phone: "+44 1", dateOfBirth: null } });
  });
  it("names the field the route would refuse", () => {
    expect(profilePatch(saved, { ...saved, firstName: "" })).toMatchObject({ ok: false, field: "firstName" });
    expect(profilePatch(saved, { ...saved, phone: "x".repeat(41) })).toMatchObject({ ok: false, field: "phone" });
    expect(profilePatch(saved, { ...saved, dateOfBirth: "2999-01-01" }, new Date("2026-09-30"))).toMatchObject({ ok: false, field: "dateOfBirth" });
  });
});

describe("presence", () => {
  it("encodes an emoji status into the one column and back", () => {
    expect(encodePresence({ emoji: "\u{1F4C5}", label: "In a meeting", expiresAt: null })).toBe("\u{1F4C5} In a meeting");
    expect(decodePresence("\u{1F4C5} In a meeting", null)).toEqual({ emoji: "\u{1F4C5}", label: "In a meeting", expiresAt: null });
    expect(decodePresence("Away", "2026-10-01T00:00:00Z")).toEqual({ emoji: null, label: "Away", expiresAt: "2026-10-01T00:00:00Z" });
  });
  it("clears the dot for Online", () => {
    expect(encodePresence({ emoji: null, label: "Online", expiresAt: null })).toBeNull();
    expect(decodePresence(null, null)).toBeNull();
  });
  it("maps statuses to the card's choices", () => {
    expect(presenceChoiceOf({ label: "Online" })).toBe("active");
    expect(presenceChoiceOf({ label: "Away" })).toBe("away");
    expect(presenceChoiceOf({ label: "Do not disturb" })).toBe("dnd");
    expect(presenceChoiceOf({ label: "Vacation" })).toBe("custom");
  });
  it("computes clear-after expiries", () => {
    const now = new Date("2026-09-30T10:00:00");
    expect(presenceExpiryFor("never", now)).toBeNull();
    expect(Date.parse(presenceExpiryFor("30m", now)!) - now.getTime()).toBe(30 * 60_000);
    const today = new Date(presenceExpiryFor("today", now)!);
    expect(today.getDate()).toBe(now.getDate());
    expect(new Date(presenceExpiryFor("week", now)!).getDay()).toBe(0);
  });
});

describe("notification presets and mute", () => {
  it("reads Default when nothing was turned off", () => {
    expect(presetOf({})).toBe("default");
    expect(presetOf(presetValues("default"))).toBe("default");
  });
  it("reads Focused back from its switches", () => {
    expect(presetOf(presetValues("focused"))).toBe("focused");
    expect(presetValues("focused")).toMatchObject({ task_assigned: true, mentions: true, comments: false, kudos: false });
  });
  it("reads Custom for any other mix", () => {
    expect(presetOf({ kudos: false })).toBe("custom");
  });
  it("mutes for the chosen time and knows forever", () => {
    const now = new Date("2026-09-30T10:00:00");
    const h = new Date(mutedUntilFor("1h", now));
    expect(h.getTime() - now.getTime()).toBe(60 * 60_000);
    const t = new Date(mutedUntilFor("tomorrow", now));
    expect(t.getHours()).toBe(9);
    expect(isMuteForever(new Date(mutedUntilFor("forever", now)), now)).toBe(true);
    expect(activeMute(new Date(now.getTime() - 1).toISOString(), now)).toBeNull();
  });
  it("silences only updates about a muted place, never what is aimed at the person", () => {
    expect(MUTABLE_NOTIFY_TYPES.has("task_assigned")).toBe(false);
    expect(MUTABLE_NOTIFY_TYPES.has("mentions")).toBe(false);
    expect(MUTABLE_NOTIFY_TYPES.has("comments")).toBe(true);
    expect(placeMuteKeys({ boardId: "b", folderId: "f", spaceId: "s" })).toEqual(["list:b", "board:b", "folder:f", "space:s"]);
    expect(mutedObjectKeys({ notifications: { muted: ["space:s", 3] } })).toEqual(["space:s"]);
    expect(mutedObjectKeys(null)).toEqual([]);
  });
});

describe("locale options", () => {
  it("maps a stored language to a wired catalog cookie, or nothing", () => {
    expect(localeCookieFor("de")).toBe("de");
    expect(localeCookieFor("en-GB")).toBe("en");
    expect(localeCookieFor("xx")).toBeNull();
    expect(localeCookieFor(null)).toBeNull();
  });
  it("never drops a stored zone the runtime does not list", () => {
    expect(timeZoneOptions("Mars/Olympus")[0]).toBe("Mars/Olympus");
    expect(timeZoneOptions(null)).toContain("UTC");
  });
});

describe("security activity words", () => {
  it("uses the naming canon", () => {
    const all = Object.values(SECURITY_EVENT_LABEL).join(" ");
    expect(all).not.toMatch(/Sign(ed)? (in|out)|MFA|2FA|Two-factor/);
    expect(SECURITY_EVENT_LABEL.login).toBe("Logged in");
  });
});

describe("last admin", () => {
  it("refuses only the last Owner or Admin", () => {
    expect(isLastAdminOf(true, 0)).toBe(true);
    expect(isLastAdminOf(true, 1)).toBe(false);
    expect(isLastAdminOf(false, 0)).toBe(false);
  });
});

import { backupCodesText } from "./backup-codes-text";
import { deleteConfirmed } from "./profile-form";
import { desktopPrefOf } from "./desktop-pref";
import { loginHrefFor } from "../session-expiry";

describe("small account rules", () => {
  it("writes the backup codes file with each code on its own line", () => {
    const t = backupCodesText(["AAAA-BBBB", "CCCC-DDDD"], "a@b.c", new Date("2026-09-30T00:00:00Z"));
    expect(t).toContain("For a@b.c");
    expect(t).toContain("Created 2026-09-30");
    expect(t.split("\n")).toEqual(expect.arrayContaining(["AAAA-BBBB", "CCCC-DDDD"]));
  });
  it("arms Delete my account only on the exact word", () => {
    expect(deleteConfirmed("DELETE")).toBe(true);
    expect(deleteConfirmed("delete")).toBe(false);
    expect(deleteConfirmed(" DELETE")).toBe(false);
  });
  it("reads the desktop key as three states", () => {
    expect(desktopPrefOf(true)).toBe("on");
    expect(desktopPrefOf(false)).toBe("off");
    expect(desktopPrefOf(undefined)).toBe("unset");
  });
  it("carries a revocation to /login and nothing else", () => {
    expect(loginHrefFor("/login?callbackUrl=%2Fhome", "revoked")).toBe("/login?callbackUrl=%2Fhome&reason=revoked");
    expect(loginHrefFor("/login", "revoked")).toBe("/login?reason=revoked");
    expect(loginHrefFor("/login?callbackUrl=%2Fhome", "expired")).toBe("/login?callbackUrl=%2Fhome");
  });
});
