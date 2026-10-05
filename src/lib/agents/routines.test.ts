import { describe, expect, it } from "vitest";
import { nextCronRun } from "./cron";
import { describeSchedule, SCHEDULE_PRESETS } from "./schedule-words";
import {
  ROUTINE_LIMITS,
  ROUTINE_REASON_TEXT,
  ROUTINE_STALE_MS,
  routineReasonForPerson,
  routineReasonText,
  routineScheduleFrom,
  routineScheduleProblem,
} from "./routines";

const ZONE = "Asia/Kolkata";

describe("routineScheduleFrom", () => {
  it("builds a cron in the person's zone for every clock kind", () => {
    expect(routineScheduleFrom({ kind: "weekdays", time: "09:00" }, ZONE)).toBe("CRON_TZ=Asia/Kolkata 0 9 * * 1-5");
    expect(routineScheduleFrom({ kind: "daily", time: "8:30" }, ZONE)).toBe("CRON_TZ=Asia/Kolkata 30 8 * * *");
    expect(routineScheduleFrom({ kind: "weekly", time: "16:00", weekday: 5 }, ZONE)).toBe("CRON_TZ=Asia/Kolkata 0 16 * * 5");
    expect(routineScheduleFrom({ kind: "monthly", time: "09:15", day: 28 }, ZONE)).toBe("CRON_TZ=Asia/Kolkata 15 9 28 * *");
  });
  it("turns ISO Sunday (7) into cron's 0", () => {
    expect(routineScheduleFrom({ kind: "weekly", time: "10:00", weekday: 7 }, ZONE)).toBe("CRON_TZ=Asia/Kolkata 0 10 * * 0");
  });
  it("writes the hourly kinds as the scheduler's words", () => {
    expect(routineScheduleFrom({ kind: "hourly" }, ZONE)).toBe("hourly");
    expect(routineScheduleFrom({ kind: "every_hours", hours: 3 }, ZONE)).toBe("every 3 hours");
    expect(routineScheduleFrom({ kind: "every_hours", hours: 1 }, ZONE)).toBe("every 1 hour");
  });
  it("names UTC rather than the server's clock for a zone that is not real", () => {
    expect(routineScheduleFrom({ kind: "daily", time: "09:00" }, "Nowhere/Land")).toBe("CRON_TZ=UTC 0 9 * * *");
    expect(routineScheduleFrom({ kind: "daily", time: "09:00" }, null)).toBe("CRON_TZ=UTC 0 9 * * *");
  });
  it("refuses an input that names no schedule", () => {
    expect(routineScheduleFrom({ kind: "daily" }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "daily", time: "24:00" }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "daily", time: "9:60" }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "weekly", time: "09:00" }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "weekly", time: "09:00", weekday: 0 }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "monthly", time: "09:00", day: 29 }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "every_hours", hours: 0 }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "every_hours", hours: 25 }, ZONE)).toBeNull();
    expect(routineScheduleFrom({ kind: "every_hours", hours: 1.5 }, ZONE)).toBeNull();
  });
  it("runs at the person's wall clock and reads in words", () => {
    const s = routineScheduleFrom({ kind: "weekdays", time: "09:00" }, ZONE)!;
    // Monday 2026-10-05 00:00 UTC: the next 9:00 in Kolkata is 03:30 UTC that day.
    expect(nextCronRun(s, new Date("2026-10-05T00:00:00Z"))?.toISOString()).toBe("2026-10-05T03:30:00.000Z");
    expect(describeSchedule(s, true)).toBe("Weekdays at 9:00");
  });
  it("builds only schedules a routine may have", () => {
    const inputs = [
      { kind: "weekdays", time: "07:45" },
      { kind: "daily", time: "23:59" },
      { kind: "weekly", time: "00:00", weekday: 1 },
      { kind: "monthly", time: "12:00", day: 1 },
      { kind: "hourly" },
      { kind: "every_hours", hours: ROUTINE_LIMITS.everyHoursMax },
    ] as const;
    for (const i of inputs) expect(routineScheduleProblem(routineScheduleFrom(i, ZONE))).toBeNull();
  });
});

describe("routineScheduleProblem", () => {
  it("accepts the presets, zoned or not, and the hourly words", () => {
    for (const p of SCHEDULE_PRESETS) {
      expect(routineScheduleProblem(p.cron)).toBeNull();
      expect(routineScheduleProblem(`CRON_TZ=${ZONE} ${p.cron}`)).toBeNull();
    }
    for (const s of ["hourly", "@hourly", "daily", "weekly", "every 2 hours", "every 24 hours", "0 * * * *"]) {
      expect(routineScheduleProblem(s)).toBeNull();
    }
  });
  it("refuses anything more often than once an hour", () => {
    for (const s of ["every 10 minutes", "every 5 minutes", "every 1 minute", "every 90 minutes", "*/30 * * * *", "0,30 9 * * *", "* * * * *", `CRON_TZ=${ZONE} */15 9 * * 1-5`]) {
      expect(routineScheduleProblem(s)).toBe("too_often");
    }
  });
  it("calls what the scheduler cannot read invalid", () => {
    for (const s of ["", "sometimes", "every 0 hours", "every 25 hours", "0 25 * * *", "CRON_TZ=Nowhere/Land 0 9 * * *"]) {
      expect(routineScheduleProblem(s)).toBe("invalid");
    }
    expect(routineScheduleProblem(null)).toBe("invalid");
  });
});

describe("the reasons", () => {
  // The dash rule for these is held with the rest of the copy (teammate-copy.test.ts).
  it("have one sentence each", () => {
    for (const text of Object.values(ROUTINE_REASON_TEXT)) expect(text).toMatch(/^[A-Z].*\.$/);
    expect(routineReasonText("agent_cap")).toBe("This teammate has used its AI questions for the month.");
    expect(routineReasonText("nonsense")).toBeNull();
    expect(routineReasonText("toString")).toBeNull();
    expect(routineReasonText(null)).toBeNull();
  });
  it("pause a person who left or was deactivated as gone", () => {
    expect(routineReasonForPerson("gone")).toBe("person_gone");
    expect(routineReasonForPerson("inactive")).toBe("person_gone");
    expect(routineReasonForPerson("guest")).toBe("guest");
    expect(routineReasonForPerson("agent_account")).toBe("agent_account");
    expect(routineReasonForPerson("ai_off")).toBe("ai_off");
  });
  it("skip a slot reached more than three hours late", () => {
    expect(ROUTINE_STALE_MS).toBe(3 * 60 * 60 * 1000);
  });
});
