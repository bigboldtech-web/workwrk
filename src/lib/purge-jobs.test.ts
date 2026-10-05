// The two clean-up switches (src/lib/purge-jobs.ts): only the exact word "on"
// turns a job on, so a typo never starts deleting; the Trash purge also needs
// the day it was turned on, and no row's window starts before that day.

import { describe, expect, it } from "vitest";
import { inboxAutoClearOn, trashClockStart, trashPurgeOn, trashPurgeSince } from "./purge-jobs";

const ON = { TRASH_PURGE_CRON: "on", TRASH_PURGE_SINCE: "2026-11-01" };

describe("purge switches", () => {
  it("are off unless set to on", () => {
    expect(trashPurgeOn({})).toBe(false);
    expect(inboxAutoClearOn({})).toBe(false);
    for (const v of ["", "1", "true", "ON", "yes", " on"]) {
      expect(trashPurgeOn({ ...ON, TRASH_PURGE_CRON: v })).toBe(false);
      expect(inboxAutoClearOn({ INBOX_AUTO_CLEAR_CRON: v })).toBe(false);
    }
  });

  it("turn on with on, each on its own", () => {
    expect(trashPurgeOn(ON)).toBe(true);
    expect(inboxAutoClearOn(ON)).toBe(false);
    expect(inboxAutoClearOn({ INBOX_AUTO_CLEAR_CRON: "on" })).toBe(true);
  });

  it("keep the Trash purge off without the day it was turned on, or with a day that is not one", () => {
    expect(trashPurgeOn({ TRASH_PURGE_CRON: "on" })).toBe(false);
    for (const v of ["", "soon", "2026-11", "01-11-2026", "2026-13-45"]) {
      expect(trashPurgeOn({ TRASH_PURGE_CRON: "on", TRASH_PURGE_SINCE: v })).toBe(false);
    }
    expect(trashPurgeSince(ON)?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("start an older row's window on the day the purge was turned on, and a newer row's on its deletion", () => {
    const old = new Date("2026-06-01T09:00:00Z");
    const recent = new Date("2026-11-20T09:00:00Z");
    expect(trashClockStart(old, ON).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(trashClockStart(recent, ON)).toBe(recent);
    expect(trashClockStart(old, {})).toBe(old);
  });
});
