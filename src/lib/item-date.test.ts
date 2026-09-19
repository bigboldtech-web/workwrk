import { describe, expect, it } from "vitest";
import {
  dayKeyInZone,
  formatTaskDate,
  hasTimeOfDay,
  isOverdue,
  localDayIso,
  relativeTime,
  resolveWeekStart,
  resolveZone,
  zonedIso,
} from "./item-date";

const IST = { timezone: "Asia/Kolkata" };
const NY = { timezone: "America/New_York" };

describe("resolveZone / resolveWeekStart", () => {
  it("prefers the stored zone", () => {
    expect(resolveZone(IST)).toBe("Asia/Kolkata");
  });

  it("falls back to the runtime zone rather than to UTC", () => {
    expect(resolveZone({ timezone: "  " })).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(resolveZone(null)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("starts the week on Monday unless told otherwise", () => {
    expect(resolveWeekStart(null)).toBe(1);
    expect(resolveWeekStart({ weekStart: 0 })).toBe(0);
    expect(resolveWeekStart({ weekStart: 9 })).toBe(1);
  });
});

describe("dayKeyInZone", () => {
  // The bug this exists to stop: an instant late on the 11th UTC is already
  // the 12th in India, and was rendering as the 11th for everyone.
  it("reads the calendar day where the viewer is, not where the server is", () => {
    const instant = "2026-09-11T20:30:00.000Z";
    expect(dayKeyInZone(instant, IST)).toBe("2026-09-12");
    expect(dayKeyInZone(instant, NY)).toBe("2026-09-11");
  });

  it("answers an empty string for an unparsable value", () => {
    expect(dayKeyInZone("not a date", IST)).toBe("");
  });
});

describe("zonedIso / localDayIso", () => {
  it("writes midnight where the viewer is, not UTC midnight", () => {
    // The bulk bar's bug (spaces-boards #24) written down as an assertion.
    expect(localDayIso("2026-09-12", IST)).toBe("2026-09-11T18:30:00.000Z");
    expect(localDayIso("2026-09-12", NY)).toBe("2026-09-12T04:00:00.000Z");
  });

  it("round-trips: the instant it writes reads back as the same day", () => {
    for (const zone of [IST, NY, { timezone: "Australia/Sydney" }, { timezone: "UTC" }]) {
      const iso = localDayIso("2026-03-29", zone);
      expect(iso).not.toBeNull();
      expect(dayKeyInZone(iso!, zone)).toBe("2026-03-29");
    }
  });

  it("uses the offset in force on that day, so a DST boundary still lands", () => {
    // New York moves to daylight time on 2026-03-08.
    expect(dayKeyInZone(localDayIso("2026-03-08", NY)!, NY)).toBe("2026-03-08");
    expect(dayKeyInZone(localDayIso("2026-11-01", NY)!, NY)).toBe("2026-11-01");
  });

  it("carries a time of day when one is given", () => {
    const iso = zonedIso("2026-09-12", 9, 30, NY);
    expect(iso).toBe("2026-09-12T13:30:00.000Z");
  });

  it("refuses a malformed day key rather than guessing", () => {
    expect(zonedIso("12/09/2026", 0, 0, NY)).toBeNull();
    expect(localDayIso("", NY)).toBeNull();
  });
});

describe("hasTimeOfDay", () => {
  it("is false for a date written as local midnight and true once a time is set", () => {
    expect(hasTimeOfDay(localDayIso("2026-09-12", IST)!, IST)).toBe(false);
    expect(hasTimeOfDay(zonedIso("2026-09-12", 9, 0, IST)!, IST)).toBe(true);
    expect(hasTimeOfDay(null, IST)).toBe(false);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-09-12T10:00:00.000Z");

  it("compares calendar days in the viewer's zone, so today is never overdue", () => {
    expect(isOverdue(localDayIso("2026-09-12", NY)!, NY, now)).toBe(false);
    expect(isOverdue(localDayIso("2026-09-11", NY)!, NY, now)).toBe(true);
    expect(isOverdue(localDayIso("2026-09-13", NY)!, NY, now)).toBe(false);
  });

  it("is false with no due date", () => {
    expect(isOverdue(null, NY, now)).toBe(false);
  });
});

describe("formatTaskDate", () => {
  it("renders something for a real date and nothing for a junk one", () => {
    expect(formatTaskDate("2026-09-12T00:00:00.000Z", NY)).toMatch(/\w/);
    expect(formatTaskDate("nope", NY)).toBe("");
    expect(formatTaskDate(null, NY)).toBe("");
  });

  it("adds the year only when it is not the current one", () => {
    const thisYear = new Date().getFullYear();
    const same = formatTaskDate(new Date(`${thisYear}-06-01T12:00:00.000Z`), { timezone: "UTC" });
    const other = formatTaskDate(new Date(`${thisYear + 2}-06-01T12:00:00.000Z`), { timezone: "UTC" });
    expect(same).not.toContain(String(thisYear));
    expect(other).toContain(String(thisYear + 2));
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-12T10:00:00.000Z");

  it("steps through the units and then gives up and shows a date", () => {
    expect(relativeTime(new Date("2026-09-12T09:59:40.000Z"), null, now)).toBe("just now");
    expect(relativeTime(new Date("2026-09-12T09:48:00.000Z"), null, now)).toBe("12m ago");
    expect(relativeTime(new Date("2026-09-12T07:00:00.000Z"), null, now)).toBe("3h ago");
    expect(relativeTime(new Date("2026-09-10T10:00:00.000Z"), null, now)).toBe("2d ago");
    expect(relativeTime(new Date("2026-08-01T10:00:00.000Z"), { timezone: "UTC" }, now)).toMatch(/Aug/);
  });

  it("never prints a negative age for a clock that is slightly ahead", () => {
    expect(relativeTime(new Date("2026-09-12T10:00:05.000Z"), { timezone: "UTC" }, now)).not.toContain("-");
  });
});

describe("the midnight hour-cycle trap", () => {
  // This suite exists because five date tests passed on a developer machine
  // and failed in CI, and the difference was the Node version rather than
  // anything in this repo. Under `hour12: false` the ICU in Node 20 answers
  // "24" for midnight; Node 24 answers "00". A "24" fed to Date.UTC rolls into
  // the next day, so every midnight write landed a day early on CI only.
  it("never reports midnight as hour 24, whatever the runtime", () => {
    for (const zone of ["Asia/Kolkata", "America/New_York", "UTC", "Australia/Sydney"]) {
      const iso = localDayIso("2026-09-12", { timezone: zone });
      expect(iso).not.toBeNull();
      const hour = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(iso!)).find((p) => p.type === "hour")?.value;
      expect(hour).toBe("00");
    }
  });

  it("writes the day it was asked for, not the day before", () => {
    // The exact shape of the CI failure: one day early, midnight only.
    for (const zone of ["Asia/Kolkata", "America/New_York", "UTC", "Pacific/Auckland"]) {
      for (const day of ["2026-01-01", "2026-03-29", "2026-09-12", "2026-12-31"]) {
        expect(dayKeyInZone(localDayIso(day, { timezone: zone })!, { timezone: zone })).toBe(day);
      }
    }
  });
});
