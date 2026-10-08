// Free time for a meeting (src/lib/connectors/free-time.ts): busy blocks
// merge, every window sits inside the working hours on the wall clock of the
// person's zone across a daylight saving change, at most `max` come back, and
// nothing starts before now.

import { describe, expect, it } from "vitest";
import { freeSlots, type Interval } from "./free-time";

const at = (iso: string) => new Date(iso).getTime();
const block = (from: string, to: string): Interval => ({ start: at(from), end: at(to) });
const iso = (slots: Interval[]) => slots.map((s) => [new Date(s.start).toISOString(), new Date(s.end).toISOString()]);

const WEEKDAYS = [1, 2, 3, 4, 5];

function slots(o: Partial<Parameters<typeof freeSlots>[0]> & { from: Date; to: Date }) {
  return freeSlots({ busy: [], durationMinutes: 30, zone: "UTC", workDays: WEEKDAYS, dayStart: "09:00", dayEnd: "18:00", now: new Date("2026-01-01T00:00:00Z"), max: 10, ...o });
}

describe("freeSlots", () => {
  it("merges busy blocks that overlap or touch, everyone's together", () => {
    const busy = [
      block("2026-10-12T10:30:00Z", "2026-10-12T11:30:00Z"),
      block("2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z"),
      block("2026-10-12T11:30:00Z", "2026-10-12T12:00:00Z"),
    ];
    expect(iso(slots({ busy, from: new Date("2026-10-12T00:00:00Z"), to: new Date("2026-10-13T00:00:00Z") }))).toEqual([
      ["2026-10-12T09:00:00.000Z", "2026-10-12T10:00:00.000Z"],
      ["2026-10-12T12:00:00.000Z", "2026-10-12T18:00:00.000Z"],
    ]);
  });

  it("keeps the working hours on the wall clock across a daylight saving change in Europe/London", () => {
    // British Summer Time ends on Sunday 25 October 2026: 09:00 is 08:00 UTC
    // on the Friday before and 09:00 UTC on the Monday after. No weekend.
    const r = slots({ zone: "Europe/London", from: new Date("2026-10-23T00:00:00Z"), to: new Date("2026-10-27T00:00:00Z") });
    expect(iso(r)).toEqual([
      ["2026-10-23T08:00:00.000Z", "2026-10-23T17:00:00.000Z"],
      ["2026-10-26T09:00:00.000Z", "2026-10-26T18:00:00.000Z"],
    ]);
    const wall = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    for (const s of r) expect([wall.format(new Date(s.start)), wall.format(new Date(s.end))]).toEqual(["09:00", "18:00"]);
  });

  it("works in a zone a quarter hour off the hour, and only in its working days", () => {
    // Kathmandu is UTC+5:45: 09:00 there is 03:15 UTC.
    const r = slots({ zone: "Asia/Kathmandu", workDays: [1], from: new Date("2026-10-11T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") });
    expect(iso(r)).toEqual([["2026-10-12T03:15:00.000Z", "2026-10-12T12:15:00.000Z"]]);
  });

  it("returns at most max, earliest first", () => {
    const r = slots({ from: new Date("2026-10-12T00:00:00Z"), to: new Date("2026-10-31T00:00:00Z"), max: 3 });
    expect(iso(r).map(([s]) => s)).toEqual(["2026-10-12T09:00:00.000Z", "2026-10-13T09:00:00.000Z", "2026-10-14T09:00:00.000Z"]);
  });

  it("starts nothing before now, rounded up to the quarter hour", () => {
    const r = slots({ now: new Date("2026-10-12T10:07:00Z"), from: new Date("2026-10-12T00:00:00Z"), to: new Date("2026-10-13T00:00:00Z") });
    expect(iso(r)).toEqual([["2026-10-12T10:15:00.000Z", "2026-10-12T18:00:00.000Z"]]);
    expect(slots({ now: new Date("2026-10-13T00:00:00Z"), from: new Date("2026-10-12T00:00:00Z"), to: new Date("2026-10-13T00:00:00Z") })).toEqual([]);
  });

  it("keeps only windows long enough, on quarter hours, and finds nothing from nonsense", () => {
    const busy = [block("2026-10-12T09:20:00Z", "2026-10-12T09:50:00Z"), block("2026-10-12T10:10:00Z", "2026-10-12T18:00:00Z")];
    const from = new Date("2026-10-12T00:00:00Z");
    const to = new Date("2026-10-13T00:00:00Z");
    // 09:00 to 09:15 is too short for 30 minutes; 09:50 rounds to 10:00 and 10:10 to 10:00: nothing.
    expect(slots({ busy, from, to })).toEqual([]);
    expect(iso(slots({ busy, from, to, durationMinutes: 15 }))).toEqual([["2026-10-12T09:00:00.000Z", "2026-10-12T09:15:00.000Z"]]);
    expect(slots({ from, to, zone: "Not/AZone" })).toEqual([]);
    expect(slots({ from, to, dayStart: "18:00", dayEnd: "09:00" })).toEqual([]);
    expect(slots({ from, to, dayStart: "9am" })).toEqual([]);
    expect(slots({ from, to, durationMinutes: 0 })).toEqual([]);
    expect(slots({ from, to, max: 0 })).toEqual([]);
  });
});
