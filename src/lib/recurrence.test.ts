import { describe, expect, it } from "vitest";
import {
  advanceDate,
  applyTimeOfDay,
  isoWeekday,
  nextOccurrenceAfter,
  occurrenceKey,
  occurrencesSince,
  parseRecurrence,
  type RecurrenceRule,
} from "./recurrence";

// Pen test 2026-11-28, V-42: a repeating task's days were read on the
// server's clock, so a Friday-evening task in California came back on a
// Thursday, and a 09:00 task in New York drifted to 10:00 at the DST change.

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({ freq: "DAY", interval: 1, ...r });

describe("a rule set in a zone runs on that zone's wall clock", () => {
  it("every Friday at 17:00 in Los Angeles stays a Friday, across UTC midnight", () => {
    const r = rule({ freq: "WEEK", weekdays: [5], tz: "America/Los_Angeles" });
    const due = new Date("2026-11-28T01:00:00Z"); // Fri 27 Nov, 17:00 PST
    expect(isoWeekday(due, r.tz)).toBe(5);
    expect(nextOccurrenceAfter(due, r, due).toISOString()).toBe("2026-12-05T01:00:00.000Z"); // Fri 4 Dec, 17:00 PST
    expect(occurrenceKey(due, r.tz)).toBe("2026-11-27");
  });

  it("every day at 09:00 in New York stays 09:00 across the DST change", () => {
    const r = rule({ tz: "America/New_York" });
    const due = new Date("2027-03-13T14:00:00Z"); // Sat 09:00 EST
    expect(advanceDate(due, r).toISOString()).toBe("2027-03-14T13:00:00.000Z"); // Sun 09:00 EDT
    expect(nextOccurrenceAfter(due, r, due).toISOString()).toBe("2027-03-14T13:00:00.000Z");
  });

  it("an explicit time is set on the zone's clock and never moves the day", () => {
    const r = rule({ atTime: "09:00", tz: "Asia/Kolkata" });
    const d = new Date("2026-12-04T20:00:00Z"); // Sat 5 Dec, 01:30 IST
    expect(applyTimeOfDay(d, r).toISOString()).toBe("2026-12-05T03:30:00.000Z"); // 5 Dec, 09:00 IST
  });

  it("the 31st of every month clamps to the month's last day there", () => {
    const r = rule({ freq: "MONTH", monthDay: 31, tz: "Europe/London" });
    const due = new Date("2027-01-31T10:00:00Z");
    const after = nextOccurrenceAfter(due, r, due);
    expect(after.toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(nextOccurrenceAfter(after, r, due).toISOString()).toBe("2027-03-31T09:00:00.000Z"); // 10:00 BST
  });

  it("a catch-up batch keys each occurrence by its day there", () => {
    const r = rule({ freq: "WEEK", weekdays: [1, 5], tz: "America/Los_Angeles" });
    const anchor = new Date("2026-11-24T01:00:00Z"); // Mon 23 Nov, 17:00 PST
    const batch = occurrencesSince(r, anchor, null, anchor, new Date("2026-12-01T12:00:00Z"));
    expect(batch.spawn.map((s) => s.key)).toEqual(["2026-11-23", "2026-11-27", "2026-11-30"]);
  });
});

describe("the rule's zone on the wire", () => {
  it("keeps a zone Intl knows and drops anything else", () => {
    expect(parseRecurrence({ freq: "DAY", interval: 1, tz: "Asia/Kolkata" })?.tz).toBe("Asia/Kolkata");
    expect(parseRecurrence({ freq: "DAY", interval: 1, tz: "Mars/Olympus" })?.tz).toBeNull();
    expect(parseRecurrence({ freq: "DAY", interval: 1 })?.tz).toBeNull();
  });

  it("guard: a rule without a zone steps on the host's clock, exactly as before", () => {
    const due = new Date(2027, 2, 13, 9, 0, 0);
    const legacy = new Date(due);
    legacy.setDate(legacy.getDate() + 1);
    expect(advanceDate(due, rule({})).getTime()).toBe(legacy.getTime());
    expect(occurrenceKey(due)).toBe(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`);
  });
});

describe("a time a DST change skips or repeats (the step 6 review)", () => {
  const daysOf2027 = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i, 12)));
  const key = (d: Date) => d.toISOString().slice(0, 10);

  it("midnight lands on its own day in zones that change their clocks at midnight", () => {
    for (const tz of ["Asia/Beirut", "Africa/Cairo", "America/Santiago", "America/Havana", "America/Asuncion"]) {
      const r = rule({ atTime: "00:00", tz });
      for (const noon of daysOf2027) {
        const day = occurrenceKey(noon, tz);
        expect(occurrenceKey(applyTimeOfDay(noon, r), tz), `${tz} ${key(noon)}`).toBe(day);
      }
    }
  });

  it("02:30 on a spring-forward night in Berlin is 03:30 that day, every other day 02:30", () => {
    const r = rule({ atTime: "02:30", tz: "Europe/Berlin" });
    const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    for (const noon of daysOf2027) {
      const at = applyTimeOfDay(noon, r);
      expect(occurrenceKey(at, "Europe/Berlin"), key(noon)).toBe(occurrenceKey(noon, "Europe/Berlin"));
      expect(clock(at), key(noon)).toBe(key(noon) === "2027-03-28" ? "03:30" : "02:30");
    }
  });

  it("a daily rule stepping through a midnight gap keeps its day and its midnight", () => {
    const r = rule({ tz: "Asia/Beirut" });
    let d = applyTimeOfDay(new Date("2027-03-20T12:00:00Z"), rule({ atTime: "00:00", tz: "Asia/Beirut" }));
    const keys: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      d = advanceDate(d, r);
      keys.push(occurrenceKey(d, "Asia/Beirut"));
    }
    expect(new Set(keys).size).toBe(14);
    expect(keys[0]).toBe("2027-03-21");
    expect(keys[13]).toBe("2027-04-03");
  });
});
