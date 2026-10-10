// The calendar tools' times and events (src/lib/connectors/google/calendar.ts,
// docs/plans/ai-teammates-phase3.md step 4): a wall-clock time is read on the
// person's clock across a daylight saving change; an all-day event's end is
// its last day here and the day after only at Google, both ways; a card's
// stored times and people are read back only as this file wrote them; who
// organizes an event, or is the person, is Google's own flag; and free/busy
// keeps busy blocks and whose calendar could not be read.

import { describe, expect, it } from "vitest";
import {
  busyBlocks,
  changedTimes,
  dayPart,
  eventFacts,
  eventTimes,
  googlePatchTimes,
  googleTimes,
  localStamp,
  readWhen,
  realDay,
  storedAttendees,
  storedTimes,
  timesForModel,
  type When,
} from "./calendar";

const at = (iso: string) => new Date(iso).getTime();

describe("days and times", () => {
  it("reads only real days, and the day a time names", () => {
    expect(realDay("2026-10-13")).toBe("2026-10-13");
    expect(realDay("2026-02-30")).toBeNull();
    expect(realDay("13/10/2026")).toBeNull();
    expect(dayPart("2026-10-13T15:00")).toBe("2026-10-13");
    expect(dayPart("next Tuesday")).toBeNull();
  });

  it("reads a time on the person's clock, across a daylight saving change in Europe/London", () => {
    // British Summer Time ends on Sunday 25 October 2026.
    expect(readWhen("2026-10-23T09:00", "Europe/London")).toEqual({ kind: "time", at: at("2026-10-23T08:00:00Z") });
    expect(readWhen("2026-10-26T09:00", "Europe/London")).toEqual({ kind: "time", at: at("2026-10-26T09:00:00Z") });
    expect(readWhen("2026-10-13", "Asia/Kolkata")).toEqual({ kind: "day", day: "2026-10-13" });
    expect(readWhen("2026-10-13T25:00", "UTC")).toBeNull();
    expect(readWhen("2026-10-13T10:00", "Not/AZone")).toBeNull();
    expect(localStamp(at("2026-10-13T04:30:00Z"), "Asia/Kolkata")).toBe("2026-10-13T10:00");
  });

  it("makes one event's times only from two days or two moments, the end not before the start", () => {
    const day = (d: string): When => ({ kind: "day", day: d });
    const time = (iso: string): When => ({ kind: "time", at: at(iso) });
    expect(eventTimes(day("2026-10-13"), day("2026-10-13"), "UTC")).toEqual({ kind: "day", start: "2026-10-13", end: "2026-10-13" });
    expect(eventTimes(day("2026-10-14"), day("2026-10-13"), "UTC")).toBe("order");
    expect(eventTimes(time("2026-10-13T10:00:00Z"), time("2026-10-13T10:00:00Z"), "UTC")).toBe("order");
    expect(eventTimes(day("2026-10-13"), time("2026-10-13T10:00:00Z"), "UTC")).toBe("mixed");
    // A start alone moves the event and keeps its length.
    const now = { kind: "time" as const, start: "2026-10-13T10:00:00.000Z", end: "2026-10-13T11:30:00.000Z", zone: "UTC" };
    expect(changedTimes(now, time("2026-10-15T09:00:00Z"), null, "UTC")).toEqual({ kind: "time", start: "2026-10-15T09:00:00.000Z", end: "2026-10-15T10:30:00.000Z", zone: "UTC" });
    expect(changedTimes(now, day("2026-10-15"), null, "UTC")).toBe("mixed");
    expect(changedTimes(null, time("2026-10-15T09:00:00Z"), null, "UTC")).toBe("unknown");
  });

  it("keeps an all-day event's last day its own, and makes Google's day after only at Google, both ways", () => {
    const days = { kind: "day" as const, start: "2026-10-14", end: "2026-10-15" };
    expect(googleTimes(days)).toEqual({ start: { date: "2026-10-14" }, end: { date: "2026-10-16" } });
    const back = eventFacts({ id: "e1", start: googleTimes(days).start, end: googleTimes(days).end }, "UTC");
    // Read back, nothing moved by a day.
    expect(back?.times).toEqual(days);
    expect(timesForModel(days, "UTC")).toEqual({ start: "2026-10-14", end: "2026-10-15", allDay: true });
    // A change clears the other kind's fields, so a day never sits beside a time.
    expect(googlePatchTimes(days).start).toEqual({ date: "2026-10-14", dateTime: null, timeZone: null });
  });

  it("reads a card's stored times only as this file writes them", () => {
    expect(storedTimes({ kind: "time", start: "2026-10-13T10:00:00Z", end: "2026-10-13T11:00:00Z", zone: "Asia/Kolkata" })).toEqual({
      kind: "time",
      start: "2026-10-13T10:00:00.000Z",
      end: "2026-10-13T11:00:00.000Z",
      zone: "Asia/Kolkata",
    });
    expect(storedTimes({ kind: "time", start: "2026-10-13T11:00:00Z", end: "2026-10-13T10:00:00Z", zone: "UTC" })).toBeNull();
    expect(storedTimes({ kind: "time", start: "2026-10-13T10:00:00Z", end: "2026-10-13T11:00:00Z", zone: "Not/AZone" })).toBeNull();
    expect(storedTimes({ kind: "day", start: "2026-10-15", end: "2026-10-14" })).toBeNull();
    expect(storedTimes("2026-10-13")).toBeNull();
  });
});

describe("events", () => {
  it("reads who organizes it and who is the person from Google's own flags, and keeps only what a change may send back", () => {
    const f = eventFacts(
      {
        id: "e-team_20261013",
        etag: '"7"',
        summary: "Team sync",
        recurringEventId: "e-team",
        start: { dateTime: "2026-10-13T10:00:00Z", timeZone: "Europe/London" },
        end: { dateTime: "2026-10-13T11:00:00Z" },
        organizer: { email: "max@mail.test", self: true },
        attendees: [
          { email: "max@mail.test", self: true, organizer: true, responseStatus: "accepted", id: "x" },
          { email: "mia@proof.test", displayName: "Mia", responseStatus: "tentative", comment: "Late", optional: true },
          { email: "not an address" },
        ],
      },
      "UTC",
    );
    expect(f).toMatchObject({ id: "e-team_20261013", etag: '"7"', instance: true, series: false, organizer: { email: "max@mail.test", self: true } });
    expect(f?.times).toEqual({ kind: "time", start: "2026-10-13T10:00:00.000Z", end: "2026-10-13T11:00:00.000Z", zone: "Europe/London" });
    expect(f?.attendees.map((p) => [p.email, p.self, p.response])).toEqual([
      ["max@mail.test", true, "accepted"],
      ["mia@proof.test", false, "tentative"],
    ]);
    // Google's own fields (self, organizer, id) are never sent back as if written.
    expect(f?.writableAttendees).toEqual([
      { email: "max@mail.test", responseStatus: "accepted" },
      { email: "mia@proof.test", displayName: "Mia", optional: true, responseStatus: "tentative", comment: "Late" },
    ]);
    expect(eventFacts({ id: "e-weekly", recurrence: ["RRULE:FREQ=WEEKLY"] }, "UTC")?.series).toBe(true);
    expect(eventFacts({ summary: "no id" }, "UTC")).toBeNull();
  });

  it("reads a card's stored people back only with an address and their writable fields", () => {
    expect(storedAttendees([{ email: "mia@proof.test", responseStatus: "accepted", self: true }])).toEqual([{ email: "mia@proof.test", responseStatus: "accepted" }]);
    expect(storedAttendees([{ responseStatus: "accepted" }])).toBeNull();
    expect(storedAttendees("mia@proof.test")).toBeNull();
  });

  it("keeps free/busy's busy blocks, and names whose calendar Google could not read", () => {
    const r = busyBlocks(
      {
        calendars: {
          primary: { busy: [{ start: "2026-10-12T10:00:00Z", end: "2026-10-12T11:00:00Z" }, { start: "bad", end: "2026-10-12T12:00:00Z" }] },
          "mia@proof.test": { busy: [] },
          "lea@proof.test": { errors: [{ reason: "notFound" }] },
        },
      },
      ["primary", "mia@proof.test", "lea@proof.test", "gone@proof.test"],
    );
    expect(r.busy).toEqual([{ start: at("2026-10-12T10:00:00Z"), end: at("2026-10-12T11:00:00Z") }]);
    expect(r.read).toEqual(["primary", "mia@proof.test"]);
    expect(r.unread).toEqual(["lea@proof.test", "gone@proof.test"]);
  });
});
