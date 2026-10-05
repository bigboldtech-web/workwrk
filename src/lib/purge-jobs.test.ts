// The two clean-up switches (src/lib/purge-jobs.ts): only the exact word "on"
// turns a job on, so a typo never starts deleting.

import { describe, expect, it } from "vitest";
import { inboxAutoClearOn, trashPurgeOn } from "./purge-jobs";

describe("purge switches", () => {
  it("are off unless set to on", () => {
    expect(trashPurgeOn({})).toBe(false);
    expect(inboxAutoClearOn({})).toBe(false);
    for (const v of ["", "1", "true", "ON", "yes", " on"]) {
      expect(trashPurgeOn({ TRASH_PURGE_CRON: v })).toBe(false);
      expect(inboxAutoClearOn({ INBOX_AUTO_CLEAR_CRON: v })).toBe(false);
    }
  });

  it("turn on with on, each on its own", () => {
    expect(trashPurgeOn({ TRASH_PURGE_CRON: "on" })).toBe(true);
    expect(inboxAutoClearOn({ TRASH_PURGE_CRON: "on" })).toBe(false);
    expect(inboxAutoClearOn({ INBOX_AUTO_CLEAR_CRON: "on" })).toBe(true);
  });
});
