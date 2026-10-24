// Notifications, Quiet, "Pick a time..." (settings-cleanup Phase 3 review,
// M2): the DateTimeField's "YYYY-MM-DDTHH:mm" is a wall clock in the WorkwrK
// time zone (home.locale.timezone), the zone the "Muted until" line is shown
// in, so it is read in that zone, never the device's. Here the device is a
// London laptop and the workspace is in Kolkata: Date.parse, which the page
// used, read 3:00 PM as 3:00 PM London, five and a half hours late.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as presets from "./notification-presets";

const realTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "Europe/London"; });
afterAll(() => { if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz; });

const PICKED = "2026-06-10T15:00";
/** 3:00 PM in Kolkata (UTC+5:30) is 09:30 UTC. */
const KOLKATA_3PM = "2026-06-10T09:30:00.000Z";

describe("customMuteUntil: a London device in a Kolkata workspace", () => {
  it("runs on a London clock (British Summer Time in June), so the device and the workspace disagree", () => {
    expect(new Date(2026, 5, 10, 15, 0).toISOString()).toBe("2026-06-10T14:00:00.000Z");
    expect(new Date(Date.parse(PICKED)).toISOString()).toBe("2026-06-10T14:00:00.000Z");
  });

  it("mutes until 3:00 PM Kolkata for 3:00 PM picked, not 3:00 PM London", () => {
    const now = Date.parse("2026-06-10T09:00:00.000Z"); // 2:30 PM in Kolkata
    expect(presets.customMuteUntil(PICKED, "Asia/Kolkata", now)).toBe(KOLKATA_3PM);
  });

  it("refuses a time already past in the workspace, though it is still ahead on the London clock", () => {
    const now = Date.parse("2026-06-10T10:00:00.000Z"); // 3:30 PM in Kolkata, 11:00 AM in London
    expect(Date.parse(PICKED)).toBeGreaterThan(now);
    expect(presets.customMuteUntil(PICKED, "Asia/Kolkata", now)).toBeNull();
    expect(presets.customMuteUntil(PICKED, "Asia/Kolkata", Date.parse(KOLKATA_3PM))).toBeNull();
  });

  it("accepts a future time, a minute ahead or a day ahead", () => {
    expect(presets.customMuteUntil(PICKED, "Asia/Kolkata", Date.parse("2026-06-10T09:29:00.000Z"))).toBe(KOLKATA_3PM);
    expect(presets.customMuteUntil("2026-06-11T09:00", "Asia/Kolkata", Date.parse("2026-06-10T09:00:00.000Z"))).toBe("2026-06-11T03:30:00.000Z");
  });

  it("reads the device's zone only when no WorkwrK zone is set, and nothing unreadable", () => {
    const now = Date.parse("2026-06-10T09:00:00.000Z");
    expect(presets.customMuteUntil(PICKED, null, now)).toBe("2026-06-10T14:00:00.000Z");
    expect(presets.customMuteUntil("", "Asia/Kolkata", now)).toBeNull();
    expect(presets.customMuteUntil("not a time", "Asia/Kolkata", now)).toBeNull();
  });
});

// Follow-up to M2: the "Until tomorrow, 9:00 am" preset (Notifications and the avatar menu) is 9:00 tomorrow on the
// WorkwrK clock. It used the device's 9:00: on this London laptop, 9:00 London, which is 1:30 pm in Kolkata.
describe("mutedUntilFor('tomorrow'): a London device in a Kolkata workspace", () => {
  it("ends at 9:00 tomorrow in Kolkata, not 9:00 London", () => {
    const now = new Date("2026-06-10T10:00:00.000Z"); // 3:30 pm in Kolkata, 11:00 am in London
    expect(presets.mutedUntilFor("tomorrow", now, "Asia/Kolkata")).toBe("2026-06-11T03:30:00.000Z");
  });

  it("takes tomorrow from the Kolkata date, which is already a day ahead of London's late in the evening", () => {
    const now = new Date("2026-06-10T20:00:00.000Z"); // 1:30 am on 11 June in Kolkata, 9:00 pm on 10 June in London
    expect(presets.mutedUntilFor("tomorrow", now, "Asia/Kolkata")).toBe("2026-06-12T03:30:00.000Z");
  });

  it("keeps the device's 9:00 when no WorkwrK zone is set, and lengths of time on any clock", () => {
    const now = new Date("2026-06-10T10:00:00.000Z");
    expect(presets.mutedUntilFor("tomorrow", now, null)).toBe("2026-06-11T08:00:00.000Z");
    expect(presets.mutedUntilFor("1h", now, "Asia/Kolkata")).toBe("2026-06-10T11:00:00.000Z");
    expect(presets.isMuteForever(new Date(presets.mutedUntilFor("forever", now, "Asia/Kolkata")), now)).toBe(true);
  });
});
