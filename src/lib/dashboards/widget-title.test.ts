import { describe, expect, it } from "vitest";
import { defaultWidgetTitle, isUntouchedWidgetTitle, newWidgetInput } from "./widget-kinds";
import type { WidgetInput } from "./widgets";

// A card's default title says what the card shows, whatever its settings.
// Before defaultWidgetTitle, a Stat kept "Open tasks" after its scope became
// Completed or its metric a Sum, and a Chart kept "Tasks by status" after it
// was grouped by Assignee.

const layout = { x: 0, y: 0, w: 3, h: 3 };
const labels = new Map([
  ["points", "Points"],
  ["team", "Team"],
]);

type Stat = Extract<WidgetInput, { kind: "stat" }>;
type Chart = Extract<WidgetInput, { kind: "chart" }>;
type List = Extract<WidgetInput, { kind: "list" }>;

const stat = (patch: Partial<Stat>): WidgetInput => ({ ...(newWidgetInput("stat", { id: "w_1", layout }) as Stat), ...patch });
const chart = (patch: Partial<Chart>): WidgetInput => ({ ...(newWidgetInput("chart", { id: "w_2", layout }) as Chart), ...patch });

describe("defaultWidgetTitle", () => {
  it("keeps the titles a new card has always started with", () => {
    expect(newWidgetInput("stat", { id: "w_1", layout })).toMatchObject({ title: "Open tasks" });
    expect(newWidgetInput("chart", { id: "w_1", layout })).toMatchObject({ title: "Tasks by status" });
    expect(newWidgetInput("list", { id: "w_1", layout })).toMatchObject({ title: "Recently updated" });
    expect(newWidgetInput("notes", { id: "w_1", layout })).toMatchObject({ title: "Text" });
  });

  it("names a Stat by its scope", () => {
    expect(defaultWidgetTitle(stat({ scope: "completed" }))).toBe("Completed tasks");
    expect(defaultWidgetTitle(stat({ scope: "overdue" }))).toBe("Overdue tasks");
    expect(defaultWidgetTitle(stat({ scope: "total" }))).toBe("All tasks");
    // An unset scope is read as the server reads it: total.
    expect(defaultWidgetTitle(stat({ scope: undefined }))).toBe("All tasks");
  });

  it("names a Sum by its field and scope, never by the raw key", () => {
    expect(defaultWidgetTitle(stat({ metric: { op: "sum", fieldKey: "points" } }), labels)).toBe("Sum of Points (open tasks)");
    expect(defaultWidgetTitle(stat({ metric: { op: "sum", fieldKey: "points" }, scope: "completed" }), labels)).toBe("Sum of Points (completed tasks)");
    expect(defaultWidgetTitle(stat({ metric: { op: "sum", fieldKey: "cf_9" } }), labels)).toBe("Sum (open tasks)");
  });

  it("names a Chart by its group", () => {
    expect(defaultWidgetTitle(chart({ groupBy: "assignee" }))).toBe("Tasks by assignee");
    expect(defaultWidgetTitle(chart({ groupBy: "priority" }))).toBe("Tasks by priority");
    expect(defaultWidgetTitle(chart({ groupBy: { field: "team" } }), labels)).toBe("Tasks by Team");
    expect(defaultWidgetTitle(chart({ groupBy: { field: "gone" } }), labels)).toBe("Tasks by field");
    // The display is how it looks, not what it counts.
    expect(defaultWidgetTitle(chart({ display: "donut" }))).toBe("Tasks by status");
  });

  it("names a List widget by its sort", () => {
    const list = newWidgetInput("list", { id: "w_3", layout }) as List;
    expect(defaultWidgetTitle({ ...list, sort: "due" })).toBe("Tasks by due date");
    expect(defaultWidgetTitle({ ...list, sort: "created" })).toBe("Recently created");
    expect(defaultWidgetTitle({ ...list, sort: undefined })).toBe("Recently updated");
  });

  it("stays within the write schema's 120 characters", () => {
    const long = new Map([["points", "P".repeat(200)]]);
    expect(defaultWidgetTitle(stat({ metric: { op: "sum", fieldKey: "points" } }), long).length).toBe(120);
  });
});

describe("isUntouchedWidgetTitle (a saved card opened for editing)", () => {
  const sum = (title: string) => stat({ title, scope: "open", metric: { op: "sum", fieldKey: "points" } } as Partial<Stat>);
  it("is not frozen as typed while the Lists' fields are still loading", () => {
    expect(isUntouchedWidgetTitle(sum("Sum of Points (open tasks)"), new Map())).toBe(true);
    expect(isUntouchedWidgetTitle(sum("Sum of Points (open tasks)"), labels)).toBe(true);
    const byTeam = chart({ title: "Tasks by Team", groupBy: { field: "team" } } as Partial<Chart>);
    expect(isUntouchedWidgetTitle(byTeam, new Map())).toBe(true);
  });
  it("follows a card whose field is gone", () => {
    expect(isUntouchedWidgetTitle(sum("Sum of Old field (open tasks)"), new Map([["other", "Other"]]))).toBe(true);
  });
  it("follows the older fallback titles and another setting's default", () => {
    expect(isUntouchedWidgetTitle(stat({ title: "Calculation" }))).toBe(true);
    expect(isUntouchedWidgetTitle(stat({ title: "Open tasks", scope: "completed" }))).toBe(true);
    expect(isUntouchedWidgetTitle(chart({ title: "Workload by Status" }))).toBe(true);
    expect(isUntouchedWidgetTitle(chart({ title: "Chart" }))).toBe(true);
    const list = newWidgetInput("list", { id: "w_3", layout }) as List;
    expect(isUntouchedWidgetTitle({ ...list, title: "Task List" })).toBe(true);
    expect(isUntouchedWidgetTitle({ ...list, title: "Tasks by due date", sort: "updated" })).toBe(true);
  });
  it("never touches a title a person typed", () => {
    expect(isUntouchedWidgetTitle(stat({ title: "Q3 launch blockers" }))).toBe(false);
    // Once Points is known, another label is somebody's own words.
    expect(isUntouchedWidgetTitle(sum("Sum of Revenue (open tasks)"), labels)).toBe(false);
    const byTeam = chart({ title: "Tasks by owner team", groupBy: { field: "team" } } as Partial<Chart>);
    expect(isUntouchedWidgetTitle(byTeam, labels)).toBe(false);
    expect(isUntouchedWidgetTitle(chart({ title: "Tasks by owner team" }), labels)).toBe(false);
  });
});
