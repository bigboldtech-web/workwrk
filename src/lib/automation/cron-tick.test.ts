import { describe, expect, it } from "vitest";
import { TICK_STALE_MS, tickIsLive } from "./cron-tick-server";
import { triggersForOrg, TIME_TRIGGER_KEYS } from "./registry-triggers";

const NOW = new Date("2026-09-27T10:00:00.000Z");

describe("the schedule cron's tick", () => {
  it("is live within the window and stale after it", () => {
    expect(tickIsLive(null, NOW)).toBe(false);
    expect(tickIsLive(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe(true);
    expect(tickIsLive(new Date(NOW.getTime() - TICK_STALE_MS), NOW)).toBe(false);
  });

  it("turns the two time triggers off in the catalog while the cron is not ticking", () => {
    const off = triggersForOrg(false, { timeTriggersLive: false });
    for (const t of off) {
      if (TIME_TRIGGER_KEYS.has(t.key)) expect(t.isEmitting).toBe(false);
      else expect(t.isEmitting).toBe(triggersForOrg(false).find((x) => x.key === t.key)?.isEmitting);
    }
    const on = triggersForOrg(false, { timeTriggersLive: true });
    expect(on.filter((t) => TIME_TRIGGER_KEYS.has(t.key)).every((t) => t.isEmitting)).toBe(true);
    // The default (no opinion) leaves the registry's own answer alone.
    expect(triggersForOrg(false).filter((t) => TIME_TRIGGER_KEYS.has(t.key)).every((t) => t.isEmitting)).toBe(true);
  });
});
