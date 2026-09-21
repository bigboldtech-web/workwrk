import { describe, expect, it } from "vitest";
import { dayKey, formatBytes, formatCount, formatDate, formatDateTitle, formatRelative, resolveDateOrder } from "./date";

// Every case pins the zone so the runtime's own zone cannot move a bucket.
const UTC = { timezone: "UTC", timeFormat: "24h" as const, dateFormat: "DMY", language: "en-GB" };
const NOW = new Date("2026-09-21T15:30:00Z"); // a Monday

describe("resolveDateOrder", () => {
  it("reads the canon words and the settings-page hints", () => {
    expect(resolveDateOrder({ dateFormat: "DMY" })).toBe("DMY");
    expect(resolveDateOrder({ dateFormat: "MDY" })).toBe("MDY");
    expect(resolveDateOrder({ dateFormat: "YMD" })).toBe("YMD");
    expect(resolveDateOrder({ dateFormat: "dd/MM/yyyy" })).toBe("DMY");
    expect(resolveDateOrder({ dateFormat: "MM/dd/yyyy" })).toBe("MDY");
    expect(resolveDateOrder({ dateFormat: "yyyy-MM-dd" })).toBe("YMD");
    expect(resolveDateOrder({})).toBe("DMY");
    expect(resolveDateOrder(null)).toBe("DMY");
  });
});

describe("formatDate smart", () => {
  it("today renders as the time", () => {
    expect(formatDate("2026-09-21T09:05:00Z", UTC, "smart", NOW)).toBe("09:05");
    expect(formatDate("2026-09-21T09:05:00Z", { ...UTC, timeFormat: "12h" }, "smart", NOW)).toMatch(/9:05\s?(am|AM)/);
  });
  it("the last seven days render as the weekday", () => {
    expect(formatDate("2026-09-20T09:05:00Z", UTC, "smart", NOW)).toBe("Sun");
    expect(formatDate("2026-09-15T23:59:00Z", UTC, "smart", NOW)).toBe("Tue");
  });
  it("seven days ago and older this year render as day and month", () => {
    expect(formatDate("2026-09-14T09:05:00Z", UTC, "smart", NOW)).toBe("14 Sept");
    expect(formatDate("2026-09-14T09:05:00Z", { ...UTC, language: "en-US" }, "smart", NOW)).toBe("14 Sep");
    expect(formatDate("2026-09-14T09:05:00Z", { ...UTC, language: "en-US", dateFormat: "MDY" }, "smart", NOW)).toBe("Sep 14");
  });
  it("another year renders day, month and year in the viewer's order", () => {
    expect(formatDate("2025-03-02T09:05:00Z", { ...UTC, language: "en-US" }, "smart", NOW)).toBe("2 Mar 2025");
    expect(formatDate("2025-03-02T09:05:00Z", { ...UTC, language: "en-US", dateFormat: "MDY" }, "smart", NOW)).toBe("Mar 2, 2025");
    expect(formatDate("2025-03-02T09:05:00Z", { ...UTC, language: "en-US", dateFormat: "YMD" }, "smart", NOW)).toBe("2025-03-02");
  });
  it("buckets by calendar day in the viewer's zone, not by 24 hour windows", () => {
    // 23:30 in Kolkata is 18:00 UTC; the viewer in Kolkata sees "today"
    // for a moment the UTC viewer sees as "today" too, but 00:30 Kolkata on
    // the 22nd is 19:00 UTC on the 21st: a different day for one of them.
    const kolkata = { ...UTC, timezone: "Asia/Kolkata" };
    const nowK = new Date("2026-09-21T19:30:00Z"); // 01:00 on the 22nd in Kolkata
    expect(formatDate("2026-09-21T18:00:00Z", UTC, "smart", nowK)).toBe("18:00");
    expect(formatDate("2026-09-21T18:00:00Z", kolkata, "smart", nowK)).toBe("Mon");
  });
  it("a future moment renders as a date, never as a weekday", () => {
    expect(formatDate("2026-09-25T09:05:00Z", { ...UTC, language: "en-US" }, "smart", NOW)).toBe("25 Sep");
  });
  it("returns an empty string for nothing and for garbage", () => {
    expect(formatDate(null, UTC)).toBe("");
    expect(formatDate(undefined, UTC)).toBe("");
    expect(formatDate("not a date", UTC)).toBe("");
  });
});

describe("formatDate fixed styles", () => {
  it("date, datetime, time and weekday are the shapes a column can promise", () => {
    const p = { ...UTC, language: "en-US" };
    expect(formatDate("2026-09-14T09:05:00Z", p, "date", NOW)).toBe("14 Sep");
    expect(formatDate("2026-09-14T09:05:00Z", p, "datetime", NOW)).toBe("14 Sep · 09:05");
    expect(formatDate("2026-09-14T09:05:00Z", p, "time", NOW)).toBe("09:05");
    expect(formatDate("2026-09-14T09:05:00Z", p, "weekday", NOW)).toBe("Mon");
  });
});

describe("formatDateTitle", () => {
  it("is the exact date and time in the viewer's zone, always with the year", () => {
    expect(formatDateTitle("2026-09-14T09:05:00Z", { ...UTC, language: "en-US" })).toBe("Mon 14 Sep 2026 · 09:05");
  });
});

describe("formatRelative", () => {
  it("counts minutes and hours today, then hands over to the smart date", () => {
    expect(formatRelative("2026-09-21T15:29:40Z", UTC, NOW)).toBe("just now");
    expect(formatRelative("2026-09-21T15:10:00Z", UTC, NOW)).toBe("20m ago");
    expect(formatRelative("2026-09-21T12:30:00Z", UTC, NOW)).toBe("3h ago");
    expect(formatRelative("2026-09-20T12:30:00Z", UTC, NOW)).toBe("Sun");
  });
});

describe("dayKey", () => {
  it("is the calendar day in the zone", () => {
    expect(dayKey("2026-09-21T19:30:00Z", UTC)).toBe("2026-09-21");
    expect(dayKey("2026-09-21T19:30:00Z", { timezone: "Asia/Kolkata" })).toBe("2026-09-22");
  });
});

describe("formatBytes", () => {
  it("picks the unit and rounds like a drive", () => {
    const p = { language: "en-US" };
    expect(formatBytes(0, p)).toBe("0 B");
    expect(formatBytes(512, p)).toBe("512 B");
    expect(formatBytes(1536, p)).toBe("1.5 KB");
    expect(formatBytes(3.4 * 1024 * 1024, p)).toBe("3.4 MB");
    expect(formatBytes(120 * 1024 * 1024, p)).toBe("120 MB");
    expect(formatBytes(1.1 * 1024 ** 3, p)).toBe("1.1 GB");
    expect(formatBytes(null, p)).toBe("0 B");
    expect(formatBytes(-5, p)).toBe("0 B");
  });
});

describe("formatCount", () => {
  it("groups per locale and never prints a fraction", () => {
    expect(formatCount(1284, { language: "en-US" })).toBe("1,284");
    expect(formatCount(1284.6, { language: "en-US" })).toBe("1,285");
    expect(formatCount(undefined, { language: "en-US" })).toBe("0");
  });
});
