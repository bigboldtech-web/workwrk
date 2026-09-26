import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cadenceLabel,
  canonicalZone,
  defaultTimezone,
  emptyScheduleForm,
  formFromSchedule,
  formProblems,
  formToCreateBody,
  formToPatchBody,
  formatRunTime,
  issueFields,
  rebaseScheduleForm,
  reportContentLine,
  specFromForm,
  timezoneOptions,
  WEEKDAY_OPTIONS,
  type ScheduleFormState,
} from "./schedule-form";
import { validateScheduleInput, validateSchedulePatch } from "./schedule";

const base: ScheduleFormState = {
  cadence: "weekly",
  weekday: 1,
  monthDay: null,
  timeOfDay: "09:00",
  timezone: "Asia/Kolkata",
  recipientIds: ["me", "ana", "raj"],
  active: true,
};

describe("the form's starting points", () => {
  it("starts weekly on Monday at 09:00 to the viewer, or to a private view's owner", () => {
    expect(emptyScheduleForm({ timezone: "UTC", viewerId: "me" })).toEqual({ cadence: "weekly", weekday: 1, monthDay: null, timeOfDay: "09:00", timezone: "UTC", recipientIds: ["me"], active: true });
    expect(emptyScheduleForm({ timezone: "UTC", viewerId: "me", privateOwnerId: "owner" }).recipientIds).toEqual(["owner"]);
  });
  it("reads a stored schedule, keeping only the day its cadence uses", () => {
    const f = formFromSchedule({ cadence: "monthly", weekday: 3, monthDay: 31, timeOfDay: "18:30", timezone: "UTC", recipients: [{ id: "a" }, { id: "a" }, { id: "b" }], active: false });
    expect(f).toEqual({ cadence: "monthly", weekday: null, monthDay: 31, timeOfDay: "18:30", timezone: "UTC", recipientIds: ["a", "b"], active: false });
  });
  it("defaults the zone to the preference, else the browser's, else UTC", () => {
    expect(defaultTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(defaultTimezone("Not/AZone")).not.toBe("Not/AZone");
    expect(defaultTimezone(null).length).toBeGreaterThan(0);
  });
  it("lists the weekdays ISO numbered, Monday first", () => {
    expect(WEEKDAY_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WEEKDAY_OPTIONS[6].label).toBe("Sunday");
  });
});

describe("the bodies the dialog sends", () => {
  it("creates a body the server's own validator accepts", () => {
    const body = formToCreateBody({ ...base, cadence: "monthly", monthDay: 31, weekday: 4 }, { kind: "dashboard", id: "d1" });
    expect(body).toMatchObject({ targetKind: "dashboard", targetId: "d1", cadence: "monthly", weekday: null, monthDay: 31 });
    expect(validateScheduleInput(body).ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain("@");
  });
  it("patches only what changed, so toggling Active never re-sends the recipients", () => {
    const original = { ...base, updatedAt: "2026-09-24T10:00:00.000Z" };
    expect(formToPatchBody({ ...base, active: false }, original)).toEqual({ expectedUpdatedAt: original.updatedAt, active: false });
    expect(formToPatchBody({ ...base, recipientIds: ["raj", "ana", "me"] }, original)).toEqual({ expectedUpdatedAt: original.updatedAt });
    const timing = formToPatchBody({ ...base, cadence: "daily" }, original);
    expect(timing).toEqual({ expectedUpdatedAt: original.updatedAt, cadence: "daily", weekday: null, monthDay: null, timeOfDay: "09:00", timezone: "Asia/Kolkata" });
    const stored = { ...specFromForm(base), recipientUserIds: base.recipientIds, active: true };
    expect(validateSchedulePatch(stored, timing).ok).toBe(true);
    expect(formToPatchBody({ ...base, recipientIds: ["me"] }, original)).toEqual({ expectedUpdatedAt: original.updatedAt, recipientUserIds: ["me"] });
  });
  it("names what stops a send, per field", () => {
    expect(formProblems(base)).toEqual({});
    expect(formProblems({ ...base, weekday: null })).toHaveProperty("weekday");
    expect(formProblems({ ...base, cadence: "monthly", monthDay: null })).toHaveProperty("monthDay");
    expect(formProblems({ ...base, timeOfDay: "24:00" })).toHaveProperty("timeOfDay");
    expect(formProblems({ ...base, timezone: "Mars/Olympus" })).toHaveProperty("timezone");
    expect(formProblems({ ...base, recipientIds: [] })).toHaveProperty("recipients");
  });
  it("puts the server's issues beside their fields as sentences", () => {
    expect(issueFields([{ path: "weekday", message: "a weekly report needs a weekday" }, { path: "timezone", message: "x" }])).toEqual({
      weekday: "Pick a day of the week.",
      timezone: "Pick a time zone this browser knows.",
    });
    expect(issueFields(null)).toEqual({});
  });
});

describe("rebaseScheduleForm after a 409", () => {
  it("never puts back someone who removed themselves, and keeps my additions and removals", () => {
    const opened = base;
    const mine = { ...base, recipientIds: ["me", "ana", "kim"] };
    // raj was removed by me; ana removed herself on the server meanwhile.
    const reloaded = { ...base, recipientIds: ["me", "raj"], active: false };
    const out = rebaseScheduleForm(mine, opened, reloaded);
    expect(out.recipientIds).toEqual(["me", "kim"]);
    expect(out.active).toBe(false);
  });
  it("takes timing from the reload unless I changed it", () => {
    const reloaded = { ...base, cadence: "daily" as const, weekday: null, timeOfDay: "07:15" };
    expect(rebaseScheduleForm(base, base, reloaded)).toMatchObject({ cadence: "daily", weekday: null, timeOfDay: "07:15" });
    const mine = { ...base, weekday: 5 };
    expect(rebaseScheduleForm(mine, base, reloaded)).toMatchObject({ cadence: "weekly", weekday: 5, timeOfDay: "07:15" });
  });
});

describe("printing times", () => {
  const at = "2026-09-28T03:30:00.000Z"; // Monday 09:00 in Kolkata
  it("prints a run in the schedule's zone with the viewer's clock", () => {
    expect(formatRunTime(at, "Asia/Kolkata", { timeFormat: "12h", dateFormat: "DMY", language: "en-GB" })).toMatch(/^Mon 28 Sep(t)?( 2026)?, 9:00 [ap]m$/i);
    expect(formatRunTime(at, "Asia/Kolkata", { timeFormat: "24h", dateFormat: "DMY", language: "en-GB" })).toMatch(/^Mon 28 Sep(t)?( 2026)?, 09:00$/);
    expect(formatRunTime(at, "UTC", { timeFormat: "24h", language: "en-GB" })).toMatch(/03:30$/);
  });
  it("reads midnight as 00, never 24", () => {
    expect(formatRunTime("2026-09-27T18:30:00.000Z", "Asia/Kolkata", { timeFormat: "24h", language: "en-GB" })).toMatch(/, 00:00$/);
    expect(formatRunTime("2026-09-27T18:30:00.000Z", "Asia/Kolkata", { timeFormat: "24h", language: "en-GB" })).toContain("28");
  });
  it("labels the cadence with the time in the viewer's clock", () => {
    expect(cadenceLabel(specFromForm(base), { timeFormat: "12h", language: "en-US" })).toBe("Every Monday at 9:00 AM (Asia/Kolkata)");
    expect(cadenceLabel({ cadence: "daily", weekday: null, monthDay: null, timeOfDay: "00:05", timezone: "UTC" }, { timeFormat: "24h" })).toBe("Every day at 00:05 (UTC)");
    // A zone reads the way the time zone picker prints it.
    expect(cadenceLabel({ cadence: "daily", weekday: null, monthDay: null, timeOfDay: "17:30", timezone: "America/New_York" }, { timeFormat: "24h" })).toBe("Every day at 17:30 (America/New York)");
    expect(cadenceLabel({ cadence: "monthly", weekday: null, monthDay: 31, timeOfDay: "09:00", timezone: "UTC" }, { timeFormat: "24h" })).toBe("Monthly on day 31, or a shorter month's last day, at 09:00 (UTC)");
  });
  it("never uses hour12: false in the source", () => {
    const src = readFileSync(join(__dirname, "schedule-form.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/hour12\s*:\s*false/);
  });
});

describe("time zone options", () => {
  it("always holds UTC and the current value, once, even under another name", () => {
    const supported = ["Africa/Abidjan", "Asia/Calcutta", "Europe/London"];
    const opts = timezoneOptions(supported, "Asia/Kolkata");
    expect(opts[0]).toBe("UTC");
    expect(opts).toContain("Asia/Kolkata");
    expect(opts.filter((z) => canonicalZone(z) === canonicalZone("Asia/Kolkata"))).toHaveLength(1);
    expect(opts).toContain("Europe/London");
    expect(timezoneOptions(supported, "UTC").filter((z) => z === "UTC")).toHaveLength(1);
  });
  it("treats two names for one zone as the same zone", () => {
    expect(canonicalZone("Asia/Kolkata")).toBe(canonicalZone("Asia/Calcutta"));
    expect(canonicalZone("Not/AZone")).toBe("Not/AZone");
  });
});

describe("reportContentLine", () => {
  it("promises exactly what each kind of email holds", () => {
    expect(reportContentLine("dashboard")).toBe("Each email shows the cards the recipient can see: numbers, chart values, list rows and text.");
    expect(reportContentLine("view")).toBe("Each email shows this view's open, overdue and done counts and the next 10 tasks by due date, filtered as the view is.");
  });
});
