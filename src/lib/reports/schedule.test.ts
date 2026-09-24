import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendRunLog,
  buildReportEmail,
  cadenceText,
  isMissingReportTableError,
  isValidTimeZone,
  nextReportRunAt,
  parseRunLog,
  recipientProblems,
  runLogForViewer,
  validateScheduleInput,
  validateSchedulePatch,
  zonedParts,
  zonedTimeToUtc,
  RUN_LOG_LIMIT,
  type RunLogEntry,
  type ScheduleSpec,
} from "./schedule";

const daily = (timeOfDay: string, timezone: string): ScheduleSpec => ({ cadence: "daily", weekday: null, monthDay: null, timeOfDay, timezone });

describe("time zones", () => {
  it("accepts IANA zones and refuses anything else", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("reads midnight as hour 0 of the same day, never 24 of the day before", () => {
    // 18:30 UTC is 00:00 the next day in Kolkata.
    expect(zonedParts(new Date("2026-09-24T18:30:00Z"), "Asia/Kolkata")).toEqual({ year: 2026, month: 9, day: 25, hour: 0, minute: 0, second: 0 });
    expect(zonedParts(new Date("2026-01-01T00:00:00Z"), "UTC")).toEqual({ year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
  });

  it("never uses hour12 in the source", () => {
    const src = readFileSync(join(__dirname, "schedule.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/hour12\s*:/);
    expect(src).toMatch(/hourCycle:\s*"h23"/);
  });

  it("turns a wall clock into the right instant, across DST", () => {
    expect(zonedTimeToUtc(2026, 9, 25, 0, 0, "Asia/Kolkata").toISOString()).toBe("2026-09-24T18:30:00.000Z");
    // New York is UTC-4 in July and UTC-5 in January.
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
});

describe("nextReportRunAt", () => {
  it("runs later today, or tomorrow once today's time has passed", () => {
    expect(nextReportRunAt(daily("09:00", "UTC"), new Date("2026-09-24T08:00:00Z"))?.toISOString()).toBe("2026-09-24T09:00:00.000Z");
    expect(nextReportRunAt(daily("09:00", "UTC"), new Date("2026-09-24T09:00:00Z"))?.toISOString()).toBe("2026-09-25T09:00:00.000Z");
  });
  it("runs at the right local midnight in a zone ahead of UTC", () => {
    expect(nextReportRunAt(daily("00:00", "Asia/Kolkata"), new Date("2026-09-24T12:00:00Z"))?.toISOString()).toBe("2026-09-24T18:30:00.000Z");
  });
  it("finds the next weekday, ISO numbered", () => {
    // 2026-09-24 is a Thursday. Monday = 1.
    const monday = { cadence: "weekly" as const, weekday: 1, monthDay: null, timeOfDay: "09:00", timezone: "UTC" };
    expect(nextReportRunAt(monday, new Date("2026-09-24T10:00:00Z"))?.toISOString()).toBe("2026-09-28T09:00:00.000Z");
    const thursday = { ...monday, weekday: 4 };
    expect(nextReportRunAt(thursday, new Date("2026-09-24T08:00:00Z"))?.toISOString()).toBe("2026-09-24T09:00:00.000Z");
  });
  it("clamps a monthly day to the month's last day", () => {
    const the31st = { cadence: "monthly" as const, weekday: null, monthDay: 31, timeOfDay: "09:00", timezone: "UTC" };
    expect(nextReportRunAt(the31st, new Date("2026-09-24T10:00:00Z"))?.toISOString()).toBe("2026-09-30T09:00:00.000Z");
    expect(nextReportRunAt(the31st, new Date("2026-02-01T00:00:00Z"))?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(nextReportRunAt(the31st, new Date("2026-09-30T09:00:00Z"))?.toISOString()).toBe("2026-10-31T09:00:00.000Z");
  });
  it("keeps the local time across a DST change", () => {
    const ny = daily("09:00", "America/New_York");
    // US DST ends on 2026-11-01.
    expect(nextReportRunAt(ny, new Date("2026-10-31T14:00:00Z"))?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(nextReportRunAt(ny, new Date("2026-10-30T12:00:00Z"))?.toISOString()).toBe("2026-10-30T13:00:00.000Z");
  });
  it("answers null for a spec that can never run", () => {
    expect(nextReportRunAt({ cadence: "weekly", weekday: null, monthDay: null, timeOfDay: "09:00", timezone: "UTC" }, new Date())).toBeNull();
    expect(nextReportRunAt(daily("24:00", "UTC"), new Date())).toBeNull();
    expect(nextReportRunAt(daily("09:00", "Nowhere/Land"), new Date())).toBeNull();
  });
});

describe("cadenceText", () => {
  it("reads naturally", () => {
    expect(cadenceText(daily("09:00", "UTC"))).toBe("Every day at 09:00 (UTC)");
    expect(cadenceText({ cadence: "weekly", weekday: 7, monthDay: null, timeOfDay: "18:30", timezone: "Asia/Kolkata" })).toBe("Every Sunday at 18:30 (Asia/Kolkata)");
    expect(cadenceText({ cadence: "monthly", weekday: null, monthDay: 31, timeOfDay: "09:00", timezone: "UTC" })).toBe("Monthly on day 31, or the last day of a shorter month, at 09:00 (UTC)");
    expect(cadenceText({ cadence: "monthly", weekday: null, monthDay: 5, timeOfDay: "09:00", timezone: "UTC" })).toBe("Monthly on day 5 at 09:00 (UTC)");
  });
});

describe("validateScheduleInput", () => {
  const good = { targetKind: "dashboard", targetId: "d1", cadence: "weekly", weekday: 1, timeOfDay: "09:00", timezone: "Asia/Kolkata", recipientUserIds: ["u1", "u2", "u1"] };
  it("accepts a good body and normalises it", () => {
    const r = validateScheduleInput(good);
    expect(r).toEqual({ ok: true, value: { cadence: "weekly", weekday: 1, monthDay: null, timeOfDay: "09:00", timezone: "Asia/Kolkata", targetKind: "dashboard", targetId: "d1", recipientUserIds: ["u1", "u2"], active: true } });
  });
  it("refuses an email address anywhere a recipient goes", () => {
    const r = validateScheduleInput({ ...good, recipientUserIds: ["someone@example.com"] });
    expect(r.ok).toBe(false);
    expect(validateScheduleInput({ ...good, recipientEmails: ["a@b.c"] }).ok).toBe(false);
  });
  it("needs the cadence's day, a real zone, a 24 hour time and at least one recipient", () => {
    expect(validateScheduleInput({ ...good, weekday: undefined }).ok).toBe(false);
    expect(validateScheduleInput({ ...good, cadence: "monthly" }).ok).toBe(false);
    expect(validateScheduleInput({ ...good, timezone: "Mars/Olympus" }).ok).toBe(false);
    expect(validateScheduleInput({ ...good, timeOfDay: "9:00" }).ok).toBe(false);
    expect(validateScheduleInput({ ...good, timeOfDay: "24:00" }).ok).toBe(false);
    expect(validateScheduleInput({ ...good, recipientUserIds: [] }).ok).toBe(false);
    expect(validateScheduleInput({ ...good, targetKind: "board" }).ok).toBe(false);
  });
  it("drops a weekday on a daily report", () => {
    const r = validateScheduleInput({ ...good, cadence: "daily" });
    expect(r.ok && r.value.weekday).toBe(null);
  });
});

describe("validateSchedulePatch", () => {
  const stored = { cadence: "daily" as const, weekday: null, monthDay: null, timeOfDay: "09:00", timezone: "UTC", recipientUserIds: ["u1"], active: true };
  const v = "2026-09-24T09:00:00.000Z";
  it("refuses a target change and a missing version", () => {
    expect(validateSchedulePatch(stored, { expectedUpdatedAt: v, targetId: "x" })).toEqual({ ok: false, error: "target_immutable" });
    expect(validateSchedulePatch(stored, { active: false })).toEqual({ ok: false, error: "version_required" });
  });
  it("merges over the stored schedule and says when timing changed", () => {
    const a = validateSchedulePatch(stored, { expectedUpdatedAt: v, cadence: "weekly", weekday: 3 });
    expect(a.ok && a.spec).toEqual({ cadence: "weekly", weekday: 3, monthDay: null, timeOfDay: "09:00", timezone: "UTC" });
    expect(a.ok && a.timingChanged).toBe(true);
    const b = validateSchedulePatch(stored, { expectedUpdatedAt: v, recipientUserIds: ["u2"] });
    expect(b.ok && b.timingChanged).toBe(false);
    expect(b.ok && b.recipientUserIds).toEqual(["u2"]);
    expect(validateSchedulePatch(stored, { expectedUpdatedAt: v, cadence: "weekly" }).ok).toBe(false);
  });
});

describe("recipientProblems", () => {
  it("names every id that is not a live member of this org", () => {
    const rows = [
      { id: "ok", organizationId: "org", deletedAt: null, status: "ACTIVE" },
      { id: "gone", organizationId: "org", deletedAt: new Date(), status: "ACTIVE" },
      { id: "off", organizationId: "org", deletedAt: null, status: "INACTIVE" },
      { id: "other", organizationId: "org2", deletedAt: null, status: "ACTIVE" },
      { id: "leave", organizationId: "org", deletedAt: null, status: "ON_LEAVE" },
    ];
    expect(recipientProblems(["ok", "gone", "off", "other", "leave", "missing"], rows, "org")).toEqual(["gone", "off", "other", "missing"]);
  });
});

describe("the run log", () => {
  const entry = (n: number): RunLogEntry => ({ dueAt: `d${n}`, ranAt: `r${n}`, outcome: "sent", sent: n, skippedNoAccess: 0, skippedInactive: 0 });
  it("keeps the newest twenty, counts only", () => {
    let log: unknown = [];
    for (let i = 0; i < 25; i += 1) log = appendRunLog(log, entry(i));
    const out = parseRunLog(log);
    expect(out).toHaveLength(RUN_LOG_LIMIT);
    expect(out[0].sent).toBe(24);
    expect(Object.keys(out[0]).sort()).toEqual(["dueAt", "outcome", "ranAt", "sent", "skippedInactive", "skippedNoAccess"]);
  });
  it("drops anything malformed and never carries extra keys", () => {
    expect(parseRunLog([{ dueAt: "a", ranAt: "b", outcome: "sent", sent: 1, recipients: ["u1"] }, { outcome: "bogus" }, 7])).toEqual([
      { dueAt: "a", ranAt: "b", outcome: "sent", sent: 1, skippedNoAccess: 0, skippedInactive: 0 },
    ]);
  });
  it("shows a non-admin that a run happened and never how many recipients could read the target", () => {
    // One recipient: {sent:1} or {skippedNoAccess:1} would BE that person's access.
    const log: RunLogEntry[] = [
      { dueAt: "d3", ranAt: "r3", outcome: "sent", sent: 1, skippedNoAccess: 0, skippedInactive: 0 },
      { dueAt: "d2", ranAt: "r2", outcome: "nothing_sent", sent: 0, skippedNoAccess: 1, skippedInactive: 0 },
      { dueAt: "d1", ranAt: "r1", outcome: "target_unavailable", sent: 0, skippedNoAccess: 0, skippedInactive: 0 },
      { dueAt: "d0", ranAt: "r0", outcome: "deactivated", sent: 0, skippedNoAccess: 0, skippedInactive: 1 },
    ];
    const seen = runLogForViewer(log, { admin: false });
    expect(seen).toEqual([
      { dueAt: "d3", ranAt: "r3", outcome: "ran" },
      { dueAt: "d2", ranAt: "r2", outcome: "ran" },
      { dueAt: "d1", ranAt: "r1", outcome: "target_unavailable" },
      { dueAt: "d0", ranAt: "r0", outcome: "deactivated" },
    ]);
    // The two person-dependent runs are indistinguishable.
    expect(JSON.stringify(seen[0]).replace(/[0-9]/g, "")).toBe(JSON.stringify(seen[1]).replace(/[0-9]/g, ""));
    expect(JSON.stringify(seen)).not.toMatch(/sent|skipped/);
  });
  it("shows an org admin every count, as stored", () => {
    const log: RunLogEntry[] = [{ dueAt: "d", ranAt: "r", outcome: "nothing_sent", sent: 0, skippedNoAccess: 1, skippedInactive: 2 }];
    expect(runLogForViewer(log, { admin: true })).toEqual(log);
  });
});

describe("buildReportEmail", () => {
  it("escapes every string and links back", () => {
    const r = buildReportEmail({ title: "<script>x</script>", kindLabel: "Dashboard", cadence: "Every day at 09:00 (UTC)", sections: [{ heading: "Open", lines: ["a & b"] }], link: "https://app.example/dashboards/1" });
    expect(r.subject).toBe("Dashboard report: <script>x</script>");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("a &amp; b");
    expect(r.html).toContain('href="https://app.example/dashboards/1"');
  });
  it("says so when there is nothing to summarise", () => {
    expect(buildReportEmail({ title: "T", kindLabel: "View", cadence: "c", sections: [], link: "/x" }).html).toContain("nothing in this report");
  });
});

describe("isMissingReportTableError", () => {
  it("recognises only the missing ReportSchedule table", () => {
    expect(isMissingReportTableError({ code: "P2021", meta: { table: "public.ReportSchedule" }, message: "The table `public.ReportSchedule` does not exist" })).toBe(true);
    expect(isMissingReportTableError(Object.assign(new Error("Unknown field `reportSchedule`"), { name: "PrismaClientValidationError" }))).toBe(true);
    expect(isMissingReportTableError({ code: "P2021", meta: { table: "public.ItemListLink" }, message: "The table `public.ItemListLink` does not exist" })).toBe(false);
    expect(isMissingReportTableError({ code: "P2002", message: "Unique constraint failed on ReportSchedule" })).toBe(false);
  });
});
