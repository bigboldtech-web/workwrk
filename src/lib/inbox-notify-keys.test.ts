import { describe, expect, it } from "vitest";
import {
  DESKTOP_RING_CALLS_DEFAULT,
  TALK_INBOX_DEFAULTS,
  TALK_INBOX_KEYS,
  TALK_INBOX_LABELS,
  inboxKeyForMessage,
  inboxRecordOf,
  inboxRowEnabled,
  userIdsWantingRow,
} from "./inbox-notify-keys";

describe("the four rows are declared once", () => {
  it("labels and defaults every key", () => {
    for (const k of TALK_INBOX_KEYS) {
      expect(TALK_INBOX_LABELS[k].label).toBeTruthy();
      expect(TALK_INBOX_LABELS[k].sub).toBeTruthy();
      expect(TALK_INBOX_DEFAULTS[k]).toBe(true);
    }
  });
  it("rings for calls by default", () => {
    expect(DESKTOP_RING_CALLS_DEFAULT).toBe(true);
  });
});

describe("inboxRowEnabled", () => {
  it("is on when the preference has never been written", () => {
    expect(inboxRowEnabled(undefined, "dm")).toBe(true);
    expect(inboxRowEnabled(null, "dm")).toBe(true);
    expect(inboxRowEnabled({}, "dm")).toBe(true);
  });
  it("is off only on an explicit false", () => {
    expect(inboxRowEnabled({ dm: false }, "dm")).toBe(false);
    expect(inboxRowEnabled({ dm: true }, "dm")).toBe(true);
  });
  it("does not let one row turn another off", () => {
    expect(inboxRowEnabled({ channel: false }, "dm")).toBe(true);
  });
});

describe("inboxRecordOf", () => {
  it("digs the record out of an untyped home blob", () => {
    expect(inboxRecordOf({ notifications: { inbox: { dm: false } } })).toEqual({ dm: false });
  });
  it("returns undefined for every shape that is not one", () => {
    expect(inboxRecordOf(null)).toBeUndefined();
    expect(inboxRecordOf("nope")).toBeUndefined();
    expect(inboxRecordOf({})).toBeUndefined();
    expect(inboxRecordOf({ notifications: null })).toBeUndefined();
    expect(inboxRecordOf({ notifications: { inbox: "nope" } })).toBeUndefined();
  });
});

describe("userIdsWantingRow", () => {
  it("keeps everyone who has not opted out, including people with no row", () => {
    const keep = userIdsWantingRow(
      [
        { userId: "a", home: { notifications: { inbox: { dm: false } } } },
        { userId: "b", home: { notifications: { inbox: { dm: true } } } },
      ],
      "dm",
      ["a", "b", "c"],
    );
    expect([...keep].sort()).toEqual(["b", "c"]);
  });
  it("keeps everyone when no preferences loaded at all", () => {
    expect([...userIdsWantingRow([], "calls", ["a", "b"])].sort()).toEqual(["a", "b"]);
  });
});

describe("inboxKeyForMessage", () => {
  it("routes a DM, a group and a channel", () => {
    expect(inboxKeyForMessage("DM", false)).toBe("dm");
    expect(inboxKeyForMessage("GROUP", false)).toBe("channel");
    expect(inboxKeyForMessage("CHANNEL", false)).toBe("channel");
  });
  it("routes a call card to Calls whatever the conversation is", () => {
    expect(inboxKeyForMessage("DM", true)).toBe("calls");
    expect(inboxKeyForMessage("CHANNEL", true)).toBe("calls");
  });
});
