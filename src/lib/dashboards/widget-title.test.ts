import { describe, expect, it } from "vitest";
import {
  defaultWidgetTitle,
  isUntouchedWidgetTitle,
  newWidgetInput,
  titleLabels,
  titleModeAfterSettingsChange,
  titleModeAfterTyping,
  titleModeFor,
  titleState,
  withEditorTitle,
} from "./widget-kinds";
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

// A title shaped like a default is not proof nobody typed it: a person who
// names a chart grouped by an Owner field "Tasks by Owner" has typed exactly
// its default. The editor used to decide by shape alone and replaced such a
// title the moment a setting changed. Who wrote the title is saved with it
// now (titleEdited), and the shape decides only for cards saved before that.
describe("titleEdited: a title a person typed is never overwritten", () => {
  const owner = new Map([["owner", "Owner"], ["budget", "Budget"]]);
  const byOwner = (patch: Partial<Chart> = {}) => chart({ title: "Tasks by Owner", groupBy: { field: "owner" }, ...patch } as Partial<Chart>);
  const budget = (patch: Partial<Stat> = {}) => stat({ title: "Sum of Budget (open tasks)", metric: { op: "sum", fieldKey: "budget" }, scope: "open", ...patch } as Partial<Stat>);

  /**
   * A saved card opened for editing and one setting changed, the way
   * widget-editor.tsx runs it: `saved` are the labels of the Lists the card
   * was saved with, `now` those of the draft's Lists.
   */
  function changeSetting(
    initial: WidgetInput,
    next: WidgetInput,
    o: { saved: ReadonlyMap<string, string>; savedReady?: boolean; now?: ReadonlyMap<string, string>; ready?: boolean },
  ) {
    const now = o.now ?? o.saved;
    const ready = o.ready ?? true;
    const mode = titleModeAfterSettingsChange(titleModeFor("edit", initial));
    const state = titleState(mode, initial, o.saved, o.savedReady ?? true);
    return { mode, state, out: withEditorTitle(next, { state, labels: titleLabels(initial, now, ready), labelsReady: ready }) };
  }

  it("keeps a typed title shaped like a default when a setting changes", () => {
    const typed = byOwner({ titleEdited: true } as Partial<Chart>);
    // By its shape alone this title reads as untouched: that was the bug.
    expect(isUntouchedWidgetTitle(typed, owner)).toBe(true);
    expect(changeSetting(typed, { ...typed, groupBy: "assignee" } as WidgetInput, { saved: owner }).out).toMatchObject({ title: "Tasks by Owner", titleEdited: true });
    expect(titleModeFor("edit", typed)).toBe("typed");
    expect(titleState("typed", typed, owner, true)).toEqual({ follows: false, edited: true });

    const sum = budget({ titleEdited: true } as Partial<Stat>);
    expect(isUntouchedWidgetTitle(sum, owner)).toBe(true);
    expect(changeSetting(sum, { ...sum, scope: "completed" } as WidgetInput, { saved: owner }).out).toMatchObject({ title: "Sum of Budget (open tasks)", titleEdited: true });
  });

  it("keeps it while the fields load and after, whatever the labels say", () => {
    const typed = byOwner({ titleEdited: true } as Partial<Chart>);
    const cases: Array<[ReadonlyMap<string, string>, boolean]> = [[new Map(), false], [owner, true], [new Map([["owner", "Team"]]), true]];
    for (const [labels, ready] of cases) {
      const r = changeSetting(typed, { ...typed, groupBy: "priority" } as WidgetInput, { saved: labels, savedReady: ready, ready });
      expect(r.out).toMatchObject({ title: "Tasks by Owner", titleEdited: true });
    }
  });

  it("flags a title as typed the moment the person types in the field", () => {
    expect(titleModeAfterTyping("Tasks by Owner")).toBe("typed");
    const state = titleState("typed", byOwner(), owner, true);
    expect(withEditorTitle(byOwner(), { state, labels: owner, labelsReady: true })).toMatchObject({ title: "Tasks by Owner", titleEdited: true });
    // Typing never changes back on its own: every later settings change keeps it.
    expect(titleModeAfterSettingsChange("typed")).toBe("typed");
  });

  it("clears the flag only when the person empties the field", () => {
    expect(titleModeAfterTyping("")).toBe("cleared");
    const typed = byOwner({ titleEdited: true } as Partial<Chart>);
    // Emptied: saved as not typed, and the settings take the title back at
    // their next change.
    const emptied = titleState("cleared", typed, owner, true);
    expect(withEditorTitle({ ...typed, title: "" } as WidgetInput, { state: emptied, labels: owner, labelsReady: true })).toMatchObject({ title: "", titleEdited: false });
    const back = titleModeAfterSettingsChange("cleared");
    expect(back).toBe("auto");
    expect(withEditorTitle({ ...typed, title: "", groupBy: "assignee" } as WidgetInput, { state: titleState(back, typed, owner, true), labels: owner, labelsReady: true })).toMatchObject({ title: "Tasks by assignee", titleEdited: false });
  });

  it("follows the settings for a card saved with titleEdited false, however it reads", () => {
    const auto = byOwner({ titleEdited: false } as Partial<Chart>);
    expect(titleModeFor("edit", auto)).toBe("auto");
    expect(changeSetting(auto, { ...auto, groupBy: "assignee" } as WidgetInput, { saved: owner }).out).toMatchObject({ title: "Tasks by assignee", titleEdited: false });
    // A renamed field is followed too, which the shape alone could not do.
    const renamed = new Map([["owner", "Account owner"]]);
    expect(isUntouchedWidgetTitle(auto, renamed)).toBe(false);
    expect(changeSetting(auto, auto, { saved: renamed }).out).toMatchObject({ title: "Tasks by Account owner", titleEdited: false });
  });

  it("starts a new card as auto and saves it flagged as the settings' title", () => {
    const fresh = newWidgetInput("stat", { id: "w_9", layout });
    expect(titleModeFor("add", fresh)).toBe("auto");
    const state = titleState("auto", fresh, new Map(), true);
    expect(withEditorTitle({ ...fresh, scope: "overdue" } as WidgetInput, { state, labels: new Map(), labelsReady: true })).toMatchObject({ title: "Overdue tasks", titleEdited: false });
  });

  it("judges a card saved before the flag by its shape, and saves the answer as the flag", () => {
    const legacy = stat({ title: "Calculation", scope: "completed" });
    expect(titleModeFor("edit", legacy)).toBe("saved");
    const r = changeSetting(legacy, { ...legacy, scope: "overdue" } as WidgetInput, { saved: new Map() });
    expect(r.mode).toBe("saved");
    expect(r.out).toMatchObject({ title: "Overdue tasks", titleEdited: false });
    // A shape the fallback reads as typed is kept, and saved as typed.
    const own = stat({ title: "Q3 launch blockers" });
    expect(changeSetting(own, { ...own, scope: "overdue" } as WidgetInput, { saved: new Map() }).out).toMatchObject({ title: "Q3 launch blockers", titleEdited: true });
  });

  it("judges an older card against the Lists it was saved with, so a new source cannot flip it", () => {
    // Saved on a List whose "team" field is labelled Team: "Tasks by owner
    // team" is somebody's own words. Moved to a List with no such field, the
    // draft's labels would read it as a default for a field they do not know.
    const legacy = chart({ title: "Tasks by owner team", groupBy: { field: "team" }, source: { kind: "lists", listIds: ["A"] } } as Partial<Chart>);
    expect(isUntouchedWidgetTitle(legacy, new Map([["other", "Other"]]))).toBe(true);
    const moved = { ...legacy, source: { kind: "lists", listIds: ["B"] } } as WidgetInput;
    const r = changeSetting(legacy, moved, { saved: labels, now: new Map([["other", "Other"]]) });
    expect(r.out).toMatchObject({ title: "Tasks by owner team", titleEdited: true });
  });

  it("does not judge an older title that could name a field before those fields arrive", () => {
    // "Tasks by owner team" reads as a default for ANY field while no label
    // is known. Judged then, a change made during the load replaced it.
    const legacy = chart({ title: "Tasks by owner team", groupBy: { field: "team" } } as Partial<Chart>);
    expect(isUntouchedWidgetTitle(legacy, new Map())).toBe(true);
    const early = changeSetting(legacy, { ...legacy, display: "donut" } as WidgetInput, { saved: new Map(), savedReady: false, ready: false });
    expect(early.state).toEqual({ follows: false, edited: undefined });
    expect(early.out).toMatchObject({ title: "Tasks by owner team" });
    // Not judged yet, a save writes no flag: the card stays as it was.
    expect("titleEdited" in early.out).toBe(false);
    // Once they arrive it is judged, here as typed, and the title stays.
    expect(titleState(early.mode, legacy, labels, true)).toEqual({ follows: false, edited: true });
    // A shape that cannot name a field is judged at once, labels or not.
    expect(titleState("saved", stat({ title: "Open tasks", scope: "completed" }), new Map(), false)).toEqual({ follows: true, edited: false });
  });
});

// While the chosen Lists' fields are on their way, a saved Sum card or a
// chart grouped by a field opened with "Sum (open tasks)" or "Tasks by
// field" in its Title field, the default with no label to name.
describe("the Title field while the fields load", () => {
  const sum = stat({ title: "Sum of Points (open tasks)", metric: { op: "sum", fieldKey: "points" }, scope: "open", titleEdited: false } as Partial<Stat>);
  const byTeam = chart({ title: "Tasks by Team", groupBy: { field: "team" }, titleEdited: false } as Partial<Chart>);
  const auto = { follows: true, edited: false };
  const loading = (initial: WidgetInput, draft: WidgetInput = initial) =>
    withEditorTitle(draft, { state: auto, labels: titleLabels(initial, new Map(), false), labelsReady: false });

  it("shows the saved title, not the generic default", () => {
    expect(defaultWidgetTitle(sum, new Map())).toBe("Sum (open tasks)");
    expect(loading(sum)).toMatchObject({ title: "Sum of Points (open tasks)" });
    expect(defaultWidgetTitle(byTeam, new Map())).toBe("Tasks by field");
    expect(loading(byTeam)).toMatchObject({ title: "Tasks by Team" });
  });

  it("still follows a setting changed meanwhile, with the saved label", () => {
    expect(loading(sum, { ...sum, scope: "completed" } as WidgetInput)).toMatchObject({ title: "Sum of Points (completed tasks)" });
  });

  it("keeps an older title that names no label until the labels arrive", () => {
    const calc = stat({ title: "Calculation", metric: { op: "sum", fieldKey: "points" } } as Partial<Stat>);
    expect(withEditorTitle(calc, { state: auto, labels: titleLabels(calc, new Map(), false), labelsReady: false })).toMatchObject({ title: "Calculation" });
    expect(withEditorTitle(calc, { state: auto, labels, labelsReady: true })).toMatchObject({ title: "Sum of Points (open tasks)" });
  });

  it("lets the real labels decide once they arrive, a gone field reading as the generic word", () => {
    const now = new Map([["points", "Story points"]]);
    expect(withEditorTitle(sum, { state: auto, labels: titleLabels(sum, now, true), labelsReady: true })).toMatchObject({ title: "Sum of Story points (open tasks)" });
    expect(withEditorTitle(sum, { state: auto, labels: titleLabels(sum, new Map(), true), labelsReady: true })).toMatchObject({ title: "Sum (open tasks)" });
  });
});
