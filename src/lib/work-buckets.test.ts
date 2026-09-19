import { describe, it, expect } from "vitest";
import {
  DUE_BUCKET_ORDER,
  addDays,
  bucketFor,
  civilDayIn,
  dayDifference,
  daysLeftInWeek,
  dueChipLabel,
  endOfWeekInstant,
  homeBucketFor,
  inboxDateLabel,
  inboxRowTime,
  normaliseWeekStart,
  startOfTodayInstant,
  weekdayOf,
  zoneOffsetMs,
} from "./work-buckets";

// A fixed instant so nothing here depends on when the test runs.
// 2026-09-16T14:30:00Z is a Wednesday afternoon in London, Wednesday morning in
// New York, and already Thursday in Auckland.
const NOW = new Date("2026-09-16T14:30:00.000Z");

describe("civilDayIn", () => {
  it("reads the calendar day in the zone you name, not the host's", () => {
    expect(civilDayIn(NOW, "UTC")).toEqual({ y: 2026, m: 9, d: 16 });
    expect(civilDayIn(NOW, "Pacific/Auckland")).toEqual({ y: 2026, m: 9, d: 17 });
    expect(civilDayIn(NOW, "America/Los_Angeles")).toEqual({ y: 2026, m: 9, d: 16 });
  });

  it("falls back to the host zone rather than throwing on a nonsense zone", () => {
    expect(() => civilDayIn(NOW, "Not/AZone")).not.toThrow();
  });

  it("treats an empty or null zone as the host zone", () => {
    expect(civilDayIn(NOW, null)).toEqual(civilDayIn(NOW, ""));
  });
});

describe("bucketFor: the viewer's midnight decides, not the server's", () => {
  it("is Today all day for a task due earlier today", () => {
    // 09:00 UTC has passed by 14:30 UTC, and the task is still Today.
    expect(bucketFor("2026-09-16T09:00:00.000Z", NOW, { timeZone: "UTC" })).toBe("today");
  });

  it("is Overdue only once the viewer's day has turned", () => {
    expect(bucketFor("2026-09-15T23:00:00.000Z", NOW, { timeZone: "UTC" })).toBe("overdue");
  });

  it("answers differently for two viewers of the same task", () => {
    // Due at 2026-09-17T02:00Z: still tomorrow in UTC, already today in Auckland.
    const due = "2026-09-17T02:00:00.000Z";
    expect(bucketFor(due, NOW, { timeZone: "UTC" })).toBe("tomorrow");
    expect(bucketFor(due, NOW, { timeZone: "Pacific/Auckland" })).toBe("today");
  });

  it("buckets a missing, empty or unparseable date as No date", () => {
    expect(bucketFor(null, NOW)).toBe("none");
    expect(bucketFor(undefined, NOW)).toBe("none");
    expect(bucketFor("", NOW)).toBe("none");
    expect(bucketFor("not a date", NOW)).toBe("none");
  });

  it("accepts a Date as readily as an ISO string", () => {
    expect(bucketFor(new Date("2026-09-16T09:00:00.000Z"), NOW, { timeZone: "UTC" })).toBe("today");
  });
});

describe("bucketFor: the week edge moves with weekStart", () => {
  // NOW is a Wednesday. Friday the 18th is +2 days.
  const friday = "2026-09-18T12:00:00.000Z";
  const sunday = "2026-09-20T12:00:00.000Z";
  const monday = "2026-09-21T12:00:00.000Z";

  it("Monday start: Friday and Sunday are this week, next Monday is Later", () => {
    const loc = { timeZone: "UTC", weekStart: 1 };
    expect(bucketFor(friday, NOW, loc)).toBe("week");
    expect(bucketFor(sunday, NOW, loc)).toBe("week");
    expect(bucketFor(monday, NOW, loc)).toBe("later");
  });

  it("Sunday start: the week ends on Saturday, so Sunday is already Later", () => {
    const loc = { timeZone: "UTC", weekStart: 0 };
    expect(bucketFor(friday, NOW, loc)).toBe("week");
    expect(bucketFor(sunday, NOW, loc)).toBe("later");
  });

  it("defaults to a Monday week when weekStart is absent", () => {
    expect(bucketFor(sunday, NOW, { timeZone: "UTC" })).toBe("week");
  });

  it("never puts Tomorrow in the week bucket: the nearer label wins", () => {
    expect(bucketFor("2026-09-17T12:00:00.000Z", NOW, { timeZone: "UTC", weekStart: 1 })).toBe("tomorrow");
  });
});

describe("daysLeftInWeek", () => {
  const wednesday = { y: 2026, m: 9, d: 16 };
  it("counts today in", () => {
    expect(daysLeftInWeek(wednesday, 1)).toBe(5); // Wed Thu Fri Sat Sun
    expect(daysLeftInWeek(wednesday, 0)).toBe(4); // Wed Thu Fri Sat
  });
  it("gives a full week on the first day of the week", () => {
    expect(daysLeftInWeek({ y: 2026, m: 9, d: 14 }, 1)).toBe(7); // a Monday
  });
});

describe("normaliseWeekStart", () => {
  it("defaults to Monday and wraps anything out of range", () => {
    expect(normaliseWeekStart(undefined)).toBe(1);
    expect(normaliseWeekStart(null)).toBe(1);
    expect(normaliseWeekStart(7)).toBe(0);
    expect(normaliseWeekStart(-1)).toBe(6);
    expect(normaliseWeekStart(3.7)).toBe(3);
  });
});

describe("homeBucketFor", () => {
  it("folds Tomorrow into This week and drops everything further out", () => {
    const loc = { timeZone: "UTC", weekStart: 1 };
    expect(homeBucketFor("2026-09-15T12:00:00.000Z", NOW, loc)).toBe("overdue");
    expect(homeBucketFor("2026-09-16T12:00:00.000Z", NOW, loc)).toBe("today");
    expect(homeBucketFor("2026-09-17T12:00:00.000Z", NOW, loc)).toBe("week");
    expect(homeBucketFor("2026-09-18T12:00:00.000Z", NOW, loc)).toBe("week");
    expect(homeBucketFor("2026-09-28T12:00:00.000Z", NOW, loc)).toBeNull();
    expect(homeBucketFor(null, NOW, loc)).toBeNull();
  });
});

describe("day arithmetic", () => {
  it("counts calendar days, not 24-hour spans", () => {
    expect(dayDifference({ y: 2026, m: 9, d: 16 }, { y: 2026, m: 9, d: 18 })).toBe(2);
    expect(dayDifference({ y: 2026, m: 12, d: 31 }, { y: 2027, m: 1, d: 1 })).toBe(1);
  });
  it("adds days across a month and a year boundary", () => {
    expect(addDays({ y: 2026, m: 9, d: 30 }, 1)).toEqual({ y: 2026, m: 10, d: 1 });
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
  });
  it("knows the weekday of a civil day", () => {
    expect(weekdayOf({ y: 2026, m: 9, d: 16 })).toBe(3); // Wednesday
  });
});

describe("instant edges", () => {
  it("startOfTodayInstant lands on the viewer's midnight", () => {
    const start = startOfTodayInstant(NOW, { timeZone: "UTC" });
    expect(start.toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  it("a zone ahead of UTC has an earlier midnight in absolute terms", () => {
    const utc = startOfTodayInstant(NOW, { timeZone: "UTC" }).getTime();
    const auckland = startOfTodayInstant(NOW, { timeZone: "Pacific/Auckland" }).getTime();
    // Auckland is already on the 17th, and its midnight is after UTC's 16th.
    expect(auckland).toBeGreaterThan(utc);
  });

  it("endOfWeekInstant is the start of the day after the week's last day", () => {
    const end = endOfWeekInstant(NOW, { timeZone: "UTC", weekStart: 1 });
    expect(end.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("every instant in the week is before the end, and next week's is not", () => {
    const end = endOfWeekInstant(NOW, { timeZone: "UTC", weekStart: 1 }).getTime();
    expect(new Date("2026-09-20T23:00:00.000Z").getTime()).toBeLessThan(end);
    expect(new Date("2026-09-21T01:00:00.000Z").getTime()).toBeGreaterThan(end);
  });
});

describe("zoneOffsetMs", () => {
  it("reads a positive offset for a zone ahead of UTC", () => {
    expect(zoneOffsetMs(NOW, "Asia/Kolkata")).toBe(5.5 * 3_600_000);
  });
  it("reads a negative offset for a zone behind UTC", () => {
    expect(zoneOffsetMs(NOW, "America/New_York")).toBe(-4 * 3_600_000);
  });
  it("is zero for UTC", () => {
    expect(zoneOffsetMs(NOW, "UTC")).toBe(0);
  });
});

describe("inboxDateLabel", () => {
  const loc = { timeZone: "UTC" };
  it("names the first two days", () => {
    expect(inboxDateLabel("2026-09-16T08:00:00.000Z", NOW, loc)).toBe("Today");
    expect(inboxDateLabel("2026-09-15T08:00:00.000Z", NOW, loc)).toBe("Yesterday");
  });
  it("gives one label per day inside the last week", () => {
    expect(inboxDateLabel("2026-09-11T08:00:00.000Z", NOW, loc)).toBe("Fri 11 Sep");
  });
  it("files anything older by month, which the old three-bucket map could not", () => {
    expect(inboxDateLabel("2026-08-02T08:00:00.000Z", NOW, loc)).toBe("August");
  });
  it("adds the year once the row is from another year", () => {
    expect(inboxDateLabel("2019-03-02T08:00:00.000Z", NOW, loc)).toBe("March 2019");
  });
  it("never throws on a bad date", () => {
    expect(inboxDateLabel("nonsense", NOW, loc)).toBe("Earlier");
  });
});

describe("inboxRowTime", () => {
  const loc = { timeZone: "UTC" };
  it("shows a clock today, a weekday this week and a date beyond it", () => {
    expect(inboxRowTime("2026-09-16T09:41:00.000Z", NOW, loc)).toMatch(/9:41/);
    expect(inboxRowTime("2026-09-14T09:41:00.000Z", NOW, loc)).toBe("Mon");
    expect(inboxRowTime("2026-09-02T09:41:00.000Z", NOW, loc)).toBe("2 Sep");
  });
  it("returns empty rather than throwing on a bad date", () => {
    expect(inboxRowTime("nope", NOW, loc)).toBe("");
  });
});

describe("dueChipLabel", () => {
  const loc = { timeZone: "UTC" };
  it("uses words for the three nearest days", () => {
    expect(dueChipLabel("2026-09-16T09:00:00.000Z", NOW, loc)).toBe("Today");
    expect(dueChipLabel("2026-09-17T09:00:00.000Z", NOW, loc)).toBe("Tomorrow");
    expect(dueChipLabel("2026-09-15T09:00:00.000Z", NOW, loc)).toBe("Yesterday");
  });
  it("falls back to a date, with a year only when it differs", () => {
    expect(dueChipLabel("2026-10-04T09:00:00.000Z", NOW, loc)).toBe("4 Oct");
    expect(dueChipLabel("2027-10-04T09:00:00.000Z", NOW, loc)).toBe("4 Oct 2027");
  });
  it("is null for no date", () => {
    expect(dueChipLabel(null, NOW, loc)).toBeNull();
  });
});

describe("the bucket order is the order the spec prints", () => {
  it("runs Overdue, Today, Tomorrow, This week, Later, No date", () => {
    expect([...DUE_BUCKET_ORDER]).toEqual(["overdue", "today", "tomorrow", "week", "later", "none"]);
  });
});
