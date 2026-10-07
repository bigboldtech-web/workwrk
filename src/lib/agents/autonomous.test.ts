// computeNextRunAt (src/lib/agents/autonomous.ts): the one next-run reader
// every schedule uses, kept when the old autonomous loop went in Phase 2
// (src/app/api/cron/run-due-agents/route.test.ts pins that the loop is gone).

import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "./autonomous";

const FROM = new Date("2026-10-07T10:17:00Z");
const HOUR = 60 * 60 * 1000;

describe("computeNextRunAt", () => {
  it("reads the keywords and the every-N forms", () => {
    expect(computeNextRunAt("hourly", FROM).getTime() - FROM.getTime()).toBe(HOUR);
    expect(computeNextRunAt(" @Hourly ", FROM).getTime() - FROM.getTime()).toBe(HOUR);
    expect(computeNextRunAt("every 30 minutes", FROM).getTime() - FROM.getTime()).toBe(30 * 60 * 1000);
    expect(computeNextRunAt("every 3 hours", FROM).getTime() - FROM.getTime()).toBe(3 * HOUR);
  });

  it("puts daily and weekly at 9:00 on the server's clock", () => {
    for (const [s, days] of [["daily", 1], ["weekly", 7]] as const) {
      const next = computeNextRunAt(s, FROM);
      expect([next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([9, 0, 0]);
      expect(next.getTime()).toBeGreaterThan(FROM.getTime() + (days - 1) * 24 * HOUR);
    }
  });

  it("runs a five-field cron at its next matching minute", () => {
    const next = computeNextRunAt("0 9 * * 1-5", FROM);
    expect(next.getTime()).toBeGreaterThan(FROM.getTime());
    expect([next.getHours(), next.getMinutes()]).toEqual([9, 0]);
    expect([1, 2, 3, 4, 5]).toContain(next.getDay());
  });

  it("runs anything it can't read an hour out, so a bad string never fire-loops", () => {
    expect(computeNextRunAt("whenever", FROM).getTime() - FROM.getTime()).toBe(HOUR);
    expect(computeNextRunAt("", FROM).getTime() - FROM.getTime()).toBe(HOUR);
  });
});
