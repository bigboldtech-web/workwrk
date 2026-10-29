// Repeating goals on screen, step 3 (docs/plans/recurring-goals.md A2 to A5,
// E1, E2, E4): the modal's rules and words, the list's Due cell, the row
// menu's Stop repeating and the delete confirm, the goal page's lines. All
// in the workspace zone (Asia/Kolkata, April fiscal year, Monday weeks).

import { describe, expect, it } from "vitest";
import {
  REPEAT_HAS_HISTORY_WORDS,
  cadenceChangeLine,
  conversionCountLine,
  goalPageDoors,
  notStartedCadenceChange,
  restartingLine,
  undoneDates,
  untilAfterCadenceChange,
  deleteGoalWords,
  endChoices,
  freshLine,
  goalChip,
  goalDatesPayload,
  offersMonthlyConversion,
  periodOfKey,
  periodTargetsLine,
  reminderFor,
  reminderOptions,
  repeatingDueText,
  repeatsRowText,
  startChoices,
  stopRepeatingOffered,
  validateGoalDates,
  type GoalDatesForm,
} from "./goal-form";
import { periodFor, type PeriodSettings } from "./goal-period";
import { verdictNarrative } from "@/lib/goal-verdict";

const IST: PeriodSettings = { timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 };
const ist = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h) - 330 * 60_000);
const OCT27 = ist(2026, 10, 27);

const form = (f: Partial<GoalDatesForm>): GoalDatesForm => ({
  type: "ONE_TIME", startDate: null, endDate: null, repeat: "MONTHLY", repeatStart: null, repeatUntil: "", reminder: "WEEKLY", firstPeriodStart: "start", ...f,
});

describe("A2: Repeating has no due date and saves without one", () => {
  it("a one-time goal still refuses with 'Pick a due date.'", () => {
    expect(validateGoalDates({ type: "ONE_TIME", startDate: null, endDate: null })).toEqual({ endDate: "Pick a due date." });
    expect(validateGoalDates({ type: "ONE_TIME", startDate: "2026-11-02", endDate: "2026-11-01" })).toEqual({ endDate: "The due date is before the start date." });
  });

  it("a repeating goal with no due date has nothing to fix", () => {
    expect(validateGoalDates({ type: "REPEATING", startDate: null, endDate: null })).toEqual({});
  });

  it("the create body carries repeat, Starts and Ends, and no due date at all", () => {
    const body = goalDatesPayload(form({ type: "REPEATING", repeat: "MONTHLY", repeatStart: "2026-11-01", endDate: "2026-12-31" }), null);
    expect(body).toEqual({ repeat: "MONTHLY", repeatStart: "2026-11-01", repeatUntil: null, checkInCadence: "WEEKLY" });
    expect("endDate" in body).toBe(false);
    expect("startDate" in body).toBe(false);
  });

  it("a one-time body is the one it always was", () => {
    expect(goalDatesPayload(form({ startDate: "2026-10-01", endDate: "2026-12-31", reminder: "MONTHLY" }), null))
      .toEqual({ startDate: "2026-10-01", endDate: "2026-12-31", checkInCadence: "MONTHLY" });
  });

  it("a conversion sends the first period's choice; an edit of a repeating goal sends only what changed", () => {
    const conv = goalDatesPayload(form({ type: "REPEATING", repeatStart: "2026-10-01", firstPeriodStart: "change" }), { repeat: null, repeatUntil: null, firstKey: null, startsEditable: true });
    expect(conv).toMatchObject({ repeat: "MONTHLY", repeatStart: "2026-10-01", firstPeriodStart: "change" });
    const untouched = goalDatesPayload(form({ type: "REPEATING", repeatStart: "2026-10-01", reminder: "MONTHLY" }), { repeat: "MONTHLY", repeatUntil: null, firstKey: "2026-10-01", startsEditable: false });
    expect(untouched).toEqual({ checkInCadence: "MONTHLY" });
    const ends = goalDatesPayload(form({ type: "REPEATING", repeat: "QUARTERLY", repeatUntil: "2027-03-31" }), { repeat: "MONTHLY", repeatUntil: null, firstKey: "2026-10-01", startsEditable: false });
    expect(ends).toEqual({ checkInCadence: "WEEKLY", repeat: "QUARTERLY", repeatUntil: "2027-03-31" });
  });

  it("making a repeating goal one time again sends repeat: null with the dates", () => {
    expect(goalDatesPayload(form({ endDate: "2026-12-31" }), { repeat: "MONTHLY", repeatUntil: null, firstKey: "2026-10-01", startsEditable: true }))
      .toEqual({ startDate: null, endDate: "2026-12-31", checkInCadence: "WEEKLY", repeat: null });
  });
});

describe("A2: Starts, Ends and the reminder", () => {
  it("on 27 October the current month is offered with what is left, and the default is November (half rule)", () => {
    const s = startChoices("MONTHLY", OCT27, IST);
    expect(s.options[0]).toEqual({ value: "2026-10-01", label: "October, 4 days left", description: "This month · 1 Oct 2026 to 31 Oct 2026" });
    expect(s.options[1]).toMatchObject({ value: "2026-11-01", label: "November 2026", description: "1 Nov 2026 to 30 Nov 2026" });
    expect(s.options).toHaveLength(13);
    expect(s.defaultKey).toBe("2026-11-01");
  });

  it("while half the month remains, the default is this month", () => {
    expect(startChoices("MONTHLY", ist(2026, 10, 10), IST).defaultKey).toBe("2026-10-01");
  });

  it("a yearly goal's choices show their fiscal dates", () => {
    const s = startChoices("YEARLY", OCT27, IST);
    expect(s.options[0].label).toMatch(/^FY27, \d+ days left$/);
    expect(s.options[0].description).toBe("This year · 1 Apr 2026 to 31 Mar 2027");
    expect(s.options[1]).toMatchObject({ label: "FY28", description: "1 Apr 2027 to 31 Mar 2028" });
  });

  it("Ends offers Never, then 'Last period: ...' after Starts, stored as the nominal last day", () => {
    const e = endChoices("MONTHLY", periodOfKey("MONTHLY", "2026-11-01", IST), IST, OCT27, { includeFrom: false });
    expect(e[0]).toMatchObject({ value: "", label: "Never" });
    expect(e[1]).toMatchObject({ value: "2026-12-31", label: "Last period: December 2026" });
    expect(e.find((o) => o.value === "2027-03-31")?.label).toBe("Last period: March 2027");
  });

  it("in edit, Ends starts at the current period (the one Stop repeating sets), and keeps a saved choice the list does not reach", () => {
    const e = endChoices("MONTHLY", periodFor("MONTHLY", OCT27, IST), IST, OCT27, { includeFrom: true, saved: "2030-06-30" });
    expect(e[1]).toMatchObject({ value: "2026-10-31", label: "Last period: October 2026" });
    expect(e[e.length - 1]).toMatchObject({ value: "2030-06-30", label: "Last period: June 2030" });
  });

  it("the line under Repeats every says what will happen", () => {
    expect(freshLine("MONTHLY", IST)).toBe("Targets start fresh on the 1st of every month. Past months keep their results.");
    expect(freshLine("WEEKLY", IST)).toBe("Targets start fresh every Monday. Past weeks keep their results.");
    expect(freshLine("WEEKLY", { ...IST, weekStart: "SUN" })).toBe("Targets start fresh every Sunday. Past weeks keep their results.");
  });

  it("a weekly goal is reminded weekly or not at all", () => {
    expect(reminderOptions("WEEKLY", true).map((o) => o.label)).toEqual(["Weekly", "Off"]);
    expect(reminderOptions("MONTHLY", true).map((o) => o.label)).toEqual(["Weekly", "Every two weeks", "Monthly", "Off"]);
    expect(reminderOptions(null, false).map((o) => o.label)).toEqual(["Weekly", "Every two weeks", "Monthly", "None"]);
    expect(reminderFor("WEEKLY", "MONTHLY")).toBe("WEEKLY");
    expect(reminderFor("MONTHLY", "MONTHLY")).toBe("MONTHLY");
  });
});

describe("A3: what a change of Repeats every does, before saving", () => {
  const october = periodFor("MONTHLY", ist(2026, 10, 20), IST);
  it("to a coarser cadence: the months until the quarter keep running", () => {
    expect(cadenceChangeLine(october, "QUARTERLY", IST, ist(2026, 10, 20))).toBe("Repeats quarterly from 1 January. November and December stay monthly.");
  });
  it("to a finer cadence: October stretches to the first Monday", () => {
    expect(cadenceChangeLine(october, "WEEKLY", IST, ist(2026, 10, 20))).toBe("Repeats weekly from Monday 2 November. October runs to 1 November.");
  });
  it("no change, no line", () => {
    expect(cadenceChangeLine(october, "MONTHLY", IST, ist(2026, 10, 20))).toBeNull();
  });
});

describe("A5: the migration offer", () => {
  const base = { repeat: null, checkInCadence: "MONTHLY", startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-31T00:00:00.000Z", completedAt: null };
  it("shows for monthly check-ins whose dates span one calendar month, while today is in it", () => {
    expect(offersMonthlyConversion(base, "2026-10-12")).toBe(true);
    expect(offersMonthlyConversion({ ...base, startDate: "2027-02-01T00:00:00.000Z", endDate: "2027-02-28T00:00:00.000Z" }, "2027-02-28")).toBe(true);
  });
  it("not for weekly check-ins, a longer or shifted span, a repeating or a completed goal", () => {
    expect(offersMonthlyConversion({ ...base, checkInCadence: "WEEKLY" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, endDate: "2026-12-31T00:00:00.000Z" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, startDate: "2026-10-05T00:00:00.000Z", endDate: "2026-11-04T00:00:00.000Z" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, endDate: "2026-10-30T00:00:00.000Z" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, startDate: null }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, repeat: "MONTHLY" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, completedAt: "2026-10-20T00:00:00.000Z" }, "2026-10-12")).toBe(false);
  });
});

const period = { label: "October 2026", lastDay: "2026-10-31", nominalLastDay: "2026-10-31", resetsOn: "2026-11-01" };

describe("A4: Stop repeating and the delete confirm", () => {
  it("is offered on a running repeating goal, not one already ending with this period, not an ended one", () => {
    expect(stopRepeatingOffered({ repeat: "MONTHLY", period })).toBe(true);
    expect(stopRepeatingOffered({ repeat: "MONTHLY", period, repeatUntil: "2027-03-31" })).toBe(true);
    expect(stopRepeatingOffered({ repeat: "MONTHLY", period, repeatUntil: "2026-10-31" })).toBe(false);
    expect(stopRepeatingOffered({ repeat: "MONTHLY", period, completedAt: "2026-11-06T00:00:00Z" })).toBe(false);
    expect(stopRepeatingOffered({ repeat: "MONTHLY", period: null })).toBe(false);
    expect(stopRepeatingOffered({ repeat: null, period })).toBe(false);
  });
  it("the delete confirm names what goes and points at Stop repeating", () => {
    expect(deleteGoalWords("Demos", { repeat: "MONTHLY", closed: 12, ended: false }))
      .toBe('Delete "Demos"? Its targets, check-ins and 12 months of results go with it, and any goals that support it move up to the top level. To keep its history, choose Stop repeating instead. This cannot be undone.');
    expect(deleteGoalWords("Demos", { repeat: "WEEKLY", closed: 1, ended: true })).toContain("1 week of results");
    expect(deleteGoalWords("Demos", { repeat: "WEEKLY", closed: 1, ended: true })).not.toContain("Stop repeating");
    expect(deleteGoalWords("Launch", null)).toBe('Delete "Launch"? Its targets and check-ins go with it, and any goals that support it move up to the top level. This can\'t be undone.');
  });
});

describe("E1, E4: the Due cell, Home and the profile", () => {
  it("a running monthly goal reads 'Resets 1 Nov', with the cadence and the period in the tooltip", () => {
    expect(repeatingDueText({ repeat: "MONTHLY", period })).toEqual({ text: "Resets 1 Nov", title: "Repeats monthly. This period: October 2026." });
  });
  it("its last period reads Ends, a stopped one Ended, one not started Starts; a one-time goal reads nothing new", () => {
    expect(repeatingDueText({ repeat: "MONTHLY", period, repeatUntil: "2026-10-31" })?.text).toBe("Ends 31 Oct");
    expect(repeatingDueText({ repeat: "MONTHLY", period, completedAt: "2026-11-06T00:00:00Z" })?.text).toBe("Ended 31 Oct");
    expect(repeatingDueText({ repeat: "MONTHLY", period: null, startDate: "2026-11-01T00:00:00.000Z" })?.text).toBe("Starts 1 Nov");
    expect(repeatingDueText({ repeat: null, period: null })).toBeNull();
  });
  it("a running repeating goal at 100% reads Target hit in the Completed tone; an ended one Completed", () => {
    expect(goalChip("completed", { repeat: "MONTHLY", completedAt: null })).toEqual({ tone: "info", label: "Target hit" });
    expect(goalChip("completed", { repeat: "MONTHLY", completedAt: "2026-11-06" }).label).toBe("Completed");
    expect(goalChip("completed", { repeat: null }).label).toBe("Completed");
    expect(goalChip("on_track", { repeat: "MONTHLY" }).label).toBe("On track");
  });
});

describe("E2: the goal page's words", () => {
  it("the Repeats row", () => {
    expect(repeatsRowText("MONTHLY", "October 2026", null, true)).toBe("Every month, since October 2026");
    expect(repeatsRowText("MONTHLY", "October 2026", "March 2027", true)).toBe("Every month, October 2026 to March 2027");
    expect(repeatsRowText("WEEKLY", "Week of 2 Nov", null, false)).toBe("Every week, from the week of 2 Nov");
    expect(repeatsRowText("WEEKLY", "Week of 7 Sep", "Week of 28 Dec", true)).toBe("Every week, the week of 7 Sep to the week of 28 Dec");
  });
  it("the Targets card's line for a period in grace, held for its KPI, closing and closed", () => {
    const base = { state: "grace" as const, takesLateNumbers: true, kpiHeld: false, graceLastDay: "2026-11-05", kpiLastDay: null, closedDay: null };
    expect(periodTargetsLine(base)).toBe("Open for late numbers until 5 Nov.");
    expect(periodTargetsLine({ ...base, kpiHeld: true, kpiLastDay: "2026-11-30" })).toBe("Open for late numbers until 5 Nov. KPI numbers until 30 Nov.");
    expect(periodTargetsLine({ ...base, takesLateNumbers: false, kpiHeld: true, kpiLastDay: "2026-11-30" })).toBe("Open for KPI numbers until 30 Nov.");
    expect(periodTargetsLine({ ...base, state: "closing", takesLateNumbers: false })).toBe("Closing");
    expect(periodTargetsLine({ ...base, state: "closed", takesLateNumbers: false, closedDay: "2026-11-06" })).toBe("Closed on 6 Nov. Its numbers are final.");
    expect(periodTargetsLine({ ...base, state: "open", takesLateNumbers: false })).toBeNull();
  });
});

describe("the step 3 review", () => {
  it("M3: a change of Repeats every keeps Ends in edit, so a stopped goal stays stopped; a new goal's Ends resets", () => {
    expect(untilAfterCadenceChange(true, "2026-10-31")).toBe("2026-10-31");
    expect(untilAfterCadenceChange(false, "2026-10-31")).toBe("");
    // Kept Ends is not sent, so the server keeps it.
    const body = goalDatesPayload(form({ type: "REPEATING", repeat: "QUARTERLY", repeatUntil: untilAfterCadenceChange(true, "2026-10-31") }), { repeat: "MONTHLY", repeatUntil: "2026-10-31", firstKey: "2026-04-01", startsEditable: false });
    expect(body).toEqual({ checkInCadence: "WEEKLY", repeat: "QUARTERLY" });
  });

  it("M2: undoing a conversion puts back the dates the goal had (Launch v2, due 31 Dec, no start)", () => {
    expect(undoneDates({ startDate: null, endDate: "2026-12-31T00:00:00.000Z" })).toEqual({ startDate: null, endDate: "2026-12-31" });
    expect(undoneDates(null)).toBeNull();
    const back = undoneDates({ startDate: null, endDate: "2026-12-31T00:00:00.000Z" })!;
    expect(goalDatesPayload(form({ type: "ONE_TIME", ...back }), { repeat: "MONTHLY", repeatUntil: null, firstKey: "2026-11-01", startsEditable: true }))
      .toEqual({ startDate: null, endDate: "2026-12-31", checkInCadence: "WEEKLY", repeat: null });
    expect(validateGoalDates({ type: "ONE_TIME", ...back })).toEqual({});
  });

  it("M4: the count line for a target added after the period began, and the line when nothing can be counted", () => {
    expect(conversionCountLine("October", { title: "New hires", now: 6, atStart: 0, atStartDay: null, addedDay: "2026-10-01" }, false))
      .toBe("Count October so far: 6 (6 now, 0 when it was added on 1 Oct)");
    expect(conversionCountLine("October", { title: "Deals", now: 38, atStart: 30, atStartDay: "2026-09-30", addedDay: null }, false))
      .toBe("Count October so far: 8 (38 now, 30 on 30 Sep)");
    expect(conversionCountLine("October", { title: "Deals", now: 38, atStart: 30, atStartDay: "2026-09-30", addedDay: null }, true)).toBe("Deals: 8 (38 now, 30 on 30 Sep) so far");
    expect(restartingLine("October", [{ title: "New hires", now: 6, startValue: 0 }])).toBe("October starts at 0. The 6 checked in so far stay in Activity and won't count.");
    expect(restartingLine("October", [])).toBeNull();
    expect(restartingLine("October", [{ title: "A", now: 6, startValue: 0 }, { title: "B", now: 2, startValue: 1 }])).toBe("October starts each target at its start value. What was checked in so far stays in Activity and won't count.");
  });

  it("L1: a goal that has not started moves Starts to the new cadence's first boundary, and says so", () => {
    expect(notStartedCadenceChange("2026-11-01", "QUARTERLY", IST)).toEqual({ key: "2027-01-01", line: "Repeats quarterly from 1 January." });
    expect(notStartedCadenceChange("2026-11-01", "WEEKLY", IST)).toEqual({ key: "2026-11-02", line: "Repeats weekly from Monday 2 November." });
  });

  it("L2: the history refusal is the server's words", () => {
    expect(REPEAT_HAS_HISTORY_WORDS).toBe("This goal has history. Stop it repeating and create a one-time goal instead.");
  });
});

describe("the goal page's doors close with the switch (2.0, L8)", () => {
  const goal = { repeat: null, checkInCadence: "MONTHLY", allAutomatic: false, startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-31T00:00:00.000Z", completedAt: null, today: "2026-10-12" };
  it("switch off: no migration offer, no target editor, and the Check-ins row as it was", () => {
    expect(goalPageDoors({ ...goal, recurringOn: false, canEdit: true })).toEqual({ migrationOffer: false, targetEditor: false, remindLabel: "Check-ins", remindWord: "Monthly", remindHidden: false });
    expect(goalPageDoors({ ...goal, checkInCadence: "NONE", allAutomatic: true, recurringOn: false, canEdit: true })).toMatchObject({ remindLabel: "Check-ins", remindWord: "No reminders", remindHidden: false });
  });
  it("switch on: the offer and the editor for editors only, the new reminder words", () => {
    expect(goalPageDoors({ ...goal, recurringOn: true, canEdit: true })).toEqual({ migrationOffer: true, targetEditor: true, remindLabel: "Remind the owner to check in", remindWord: "Monthly", remindHidden: false });
    expect(goalPageDoors({ ...goal, recurringOn: true, canEdit: false })).toMatchObject({ migrationOffer: false, targetEditor: false });
    expect(goalPageDoors({ ...goal, checkInCadence: "NONE", allAutomatic: true, recurringOn: true, canEdit: true })).toMatchObject({ remindWord: "Off", remindHidden: true });
  });
  it("a goal that already repeats reads the new words even with the switch off, and offers no door", () => {
    expect(goalPageDoors({ ...goal, repeat: "MONTHLY", recurringOn: false, canEdit: true })).toMatchObject({ migrationOffer: false, targetEditor: false, remindLabel: "Remind the owner to check in" });
  });
});

describe("the assessment's words for a period that hit its number", () => {
  const base = { progress: 100, pctTimeElapsed: 100, daysLeft: null, isStale: false, daysSinceCheckin: 1, hasLinkedWork: false, totalHours: 0, tasksOpen: 0, tasksDone: 0 };
  it("say Target hit for the period, never that the goal is complete; a one-time goal reads as before", () => {
    expect(verdictNarrative("completed", { ...base, periodLabel: "Week of 19 Oct" })).toMatchObject({ headline: "Target hit for Week of 19 Oct.", recommendation: "Nothing more is needed for Week of 19 Oct." });
    expect(verdictNarrative("completed", { ...base, periodLabel: null })).toMatchObject({ headline: "This goal is complete.", recommendation: "Nothing to do. Start the next goal when you are ready." });
  });
});
