// Repeating goals, the final review's product, accessibility and copy
// findings (b7ef7be6, 2026-10-29), as the screens draw them: rendered to
// static markup (what the browser receives on the first paint). The server
// and the pure words are src/lib/goals/goal-final-product.test.ts. Where a
// layout cannot be reached by a static render (the inline composer opens on
// a click, the Edit modal's conversion facts arrive by a fetch), the source
// is read as a contract.

import { describe, expect, it, vi } from "vitest";
import { createElement as h, createRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { contentProps } = vi.hoisted(() => ({ contentProps: [] as Array<Record<string, unknown>> }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u-1" } } }) }));
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/dialog-provider", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/ui/dialog", () => {
  const pass = ({ children }: { children?: ReactNode }) => h("div", null, children);
  // The content's props are kept: what closing the dialog does with focus is asserted.
  const content = (props: Record<string, unknown> & { children?: ReactNode }) => {
    contentProps.push(props);
    return h("div", null, props.children);
  };
  return { Dialog: pass, DialogContent: content, DialogHeader: pass, DialogTitle: pass, DialogFooter: pass, DialogDescription: pass };
});
// The menus, open: their items are what is asserted.
vi.mock("@/components/layout/os/more-portal", () => ({ MorePortal: ({ children }: { children?: ReactNode }) => h("div", { "data-menu": "" }, children) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => ({ ok: false, error: "not in a test" }) }));

import { GoalTargets, pausedLine, targetSourceText, type TargetRowData } from "./goal-targets";
import { checkInTitle, OkrCheckInModal, returnFocusOnClose } from "./okr-checkin-modal";
import { GoalAssessment } from "./goal-assessment";
import { PastPeriods, GoalPeriodControl } from "./goal-period-bits";
import { previewLineFor, rightNowHint, TargetEditor } from "./target-editor";
import { TableFilterEditor } from "./table-filter-editor";
import { CreateGoalModal, GoalConversionBlock } from "@/components/okrs/create-goal-modal";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PickerButton, SettingsRow } from "@/components/dashboards/widget-registry";
import { WidgetFilterEditor } from "@/components/dashboards/widget-filter-editor";
import { WidgetSourcePicker } from "@/components/dashboards/widget-source-picker";
import { endedSoFar } from "@/lib/goals/goal-form";
import type { PeriodSettings } from "@/lib/goals/goal-period";
import type { PastPeriodRow } from "@/lib/goals/goal-period-view.server";

const IST: PeriodSettings = { timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 };
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const target = (extra: Partial<TargetRowData> = {}): TargetRowData => ({
  id: "kr1", title: "Demos booked", unit: "demos", startValue: 0, targetValue: 40, currentValue: 18, progress: 45,
  isDerived: false, kpiName: null, lastCheckIn: "2d ago", ...extra,
});
const listSource = (extra: Partial<NonNullable<TargetRowData["source"]>> = {}): NonNullable<TargetRowData["source"]> => ({
  label: "From Sales pipeline", private: false, href: "/boards/sales", connectorName: null, paused: null, settings: null, ...extra,
});
const editor = { okrId: "g1", repeat: "MONTHLY" as const, ownerId: "u1", periodWord: "This month", kpiMonths: ["2026-10"] };
const november = { key: "2026-11-01", label: "November 2026", current: true, state: "open" as const, takesCheckIns: true, line: null };
const rowOf = (html: string) => html.slice(html.indexOf("<li"), html.indexOf("</li>"));

describe("H1: late numbers for October are said on November's card, and the check-in names its period", () => {
  it("the line and the link to October, on the period running now", () => {
    const period = { ...november, late: { line: "October still takes late numbers until 5 Nov.", linkLabel: "Check in for October", href: "/okrs/g1?period=2026-10-01" } };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()], period, editor }));
    expect(html).toContain("October still takes late numbers until 5 Nov.");
    expect(html).toMatch(/<a [^>]*href="\/okrs\/g1\?period=2026-10-01"[^>]*>Check in for October<\/a>/);
  });

  it("the title always names the period: Check in on Demos booked for November 2026", () => {
    expect(checkInTitle(target(), true, { label: "November 2026" })).toBe("Check in on Demos booked for November 2026");
    expect(checkInTitle(target(), true, null)).toBe("Check in on Demos booked");
    const html = renderToStaticMarkup(h(OkrCheckInModal, { okrId: "g1", canEdit: true, onClose: () => {}, target: target(), period: { key: "2026-11-01", label: "November 2026", ended: false } }));
    expect(html).toContain("Check in on Demos booked for November 2026");
  });
});

describe("H2: a goal that has not started takes targets and no check-in", () => {
  it("no Check in anywhere on the card, the menu reads View target, and targets can be added", () => {
    const period = { key: "2026-11-01", label: "November 2026", current: false, state: "open" as const, takesCheckIns: false, line: null, notStarted: true };
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, targets: [target()], period, editor }));
    expect(html).not.toMatch(/>Check in</);
    expect(html).toContain("View target");
    expect(html).toContain("Add target");
    expect(html).toContain("Edit target");
  });
});

describe("H3: the source, Carried from and a pause show below 1280, and no tooltip carries them", () => {
  it("an editor reads the pause with its reason, under the row, at every width", () => {
    const reason = "Priya can no longer open a List it counts. Reconnect it.";
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, editor, period: november,
      targets: [target({ source: listSource({ paused: reason }) })] }));
    const row = rowOf(html);
    expect(row).toContain(`Paused. The last number counted stands. ${reason}`);
    expect(row).toMatch(/<span class="order-4 w-full[^"]*">Paused\./);
    expect(row).not.toMatch(/title="[^"]*Priya can no longer/);
    // The source: the column from 1280, a line of its own below it.
    expect(row).toMatch(/<span class="order-3 w-full[^"]*xl:hidden[^"]*">From Sales pipeline<\/span>/);
    expect(row).toMatch(/<span class="hidden [^"]*xl:inline[^"]*">From Sales pipeline<\/span>/);
  });

  it("anyone else reads that it is paused and that the number stands, without the reason", () => {
    expect(pausedLine(listSource({ paused: "Paused" }), false)).toBe("Paused. The last number counted stands.");
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: false, canCheckIn: false, period: november, targets: [target({ source: listSource({ paused: "Paused" }) })] }));
    expect(rowOf(html)).toContain("Paused. The last number counted stands.");
  });

  it("Carried from October and a KPI are lines below 1280; a hand target keeps one 36px line", () => {
    expect(targetSourceText(target({ carriedFrom: "October" }))).toBe("Carried from October");
    expect(targetSourceText(target({ isDerived: true, kpiName: "NPS" }))).toBe("From KPI NPS");
    expect(targetSourceText(target())).toBeNull();
    const carried = rowOf(renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, period: november, targets: [target({ carriedFrom: "October" })] })));
    expect(carried).toMatch(/<span class="order-3 w-full[^"]*xl:hidden[^"]*">Carried from October<\/span>/);
    expect(carried).toMatch(/<li class="[^"]*\bxl:h-9\b[^"]*\bxl:flex-nowrap\b/);
    const plain = rowOf(renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, period: november, targets: [target()] })));
    expect(plain).toMatch(/<li class="[^"]*\bsm:h-9\b[^"]*\bsm:flex-nowrap\b/);
    expect(plain).not.toContain("order-3");
    // The numbers carry no tooltip of their own: what they say is on the row.
    expect(plain).not.toMatch(/title="Start 0, now 18/);
  });
});

describe("M1: the Summary of a period in its grace", () => {
  it("its result so far and when late numbers stop, no pace, no next step", () => {
    const ended = endedSoFar({ label: "Week of 19 Oct", state: "grace", progress: 84, attainment: 84, takesLateNumbers: true, kpiHeld: false, graceLastDay: "2026-10-27", kpiLastDay: null })!;
    const html = renderToStaticMarkup(h(GoalAssessment, { okrId: "g1", initialVerdict: "on_track", cadence: "WEEKLY", canCheckIn: true, periodKey: "2026-10-19", ended }));
    expect(html).toContain("Week of 19 Oct ended:");
    expect(html).toContain(">Partly hit so far<");
    expect(html).toContain(">84%<");
    expect(html).toContain("Late numbers until 27 Oct.");
    expect(html).not.toContain("On track?");
    expect(html).not.toContain("Next:");
    expect(html).not.toContain("time used");
  });
});

describe("M6: Keep repeating and Repeat again in the row menu", () => {
  const period = { label: "October 2026", lastDay: "2026-10-31", nominalLastDay: "2026-10-31", resetsOn: "2026-11-01" };
  const menu = (repeating: Record<string, unknown>, recurringOn: boolean) => renderToStaticMarkup(h(GoalRowMoreMenu, { goal: { id: "g1", title: "Demos" }, canDelete: true, canEdit: true, repeating, recurringOn }));
  it("each state offers its one action", () => {
    expect(menu({ repeat: "MONTHLY", period }, true)).toContain("Stop repeating");
    const keep = menu({ repeat: "MONTHLY", period, repeatUntil: "2026-10-31" }, true);
    expect(keep).toContain("Keep repeating");
    expect(keep).not.toContain("Stop repeating");
    expect(menu({ repeat: "MONTHLY", period, completedAt: "2026-11-06T00:00:00Z" }, true)).toContain("Repeat again");
    expect(menu({ repeat: "MONTHLY", period, completedAt: "2026-11-06T00:00:00Z" }, false)).not.toContain("Repeat again");
  });
});

describe("M7: the composer's door names what it opens", () => {
  it("Count from a List or table, never More options", () => {
    const file = src("./goal-targets.tsx");
    expect(file).toContain(">Count from a List or table</Button>");
    expect(file).not.toContain(">More options<");
  });
});

describe("M8: the conversion block sits under Starts", () => {
  it("the block renders the choice and its count lines", () => {
    const html = renderToStaticMarkup(h(GoalConversionBlock, {
      conversion: { periodName: "October", startDay: "2026-10-01", targets: [{ title: "Demos", now: 5, atStart: 3, atStartDay: "2026-09-30", addedDay: null, startValue: 0 }] },
      firstPeriodStart: "start", onFirstPeriodStart: () => {}, restartLine: null,
    }));
    expect(html).toContain("October starts at");
    expect(html).toContain("What was added since 1 Oct: 2 (5 now, 3 on 30 Sep)");
  });
  it("in the modal, after Starts and Ends, never under Goal type; the due date's removal is said under Starts", () => {
    const file = src("../../../../components/okrs/create-goal-modal.tsx");
    const body = file.slice(file.indexOf("export function CreateGoalModal"));
    const goalType = body.indexOf("<span>Goal type</span>");
    const starts = body.indexOf("<span>Starts</span>");
    const ends = body.indexOf("<span>Ends</span>");
    const block = body.indexOf("<GoalConversionBlock");
    expect(goalType).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(ends);
    expect(ends).toBeGreaterThan(starts);
    expect(body.slice(goalType, starts)).not.toContain("starts at");
    expect(body.indexOf("{removedDueLine ?")).toBeGreaterThan(starts);
    expect(body.indexOf("{removedDueLine ?")).toBeLessThan(ends);
  });
});

describe("M9: closing the check-in or the editor puts focus back on the control that opened it", () => {
  it("onCloseAutoFocus focuses the row's button while it is on the page, and leaves Radix alone otherwise", () => {
    const focus = vi.fn();
    const ref = { current: { isConnected: true, focus } as unknown as HTMLElement };
    const prevented = vi.fn();
    returnFocusOnClose(ref)({ preventDefault: prevented } as unknown as Event);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(prevented).toHaveBeenCalledTimes(1);
    const gone = { current: { isConnected: false, focus } as unknown as HTMLElement };
    returnFocusOnClose(gone)({ preventDefault: prevented } as unknown as Event);
    expect(focus).toHaveBeenCalledTimes(1);
    returnFocusOnClose(null)({ preventDefault: prevented } as unknown as Event);
    expect(prevented).toHaveBeenCalledTimes(1);
  });

  it("both dialogs hand Radix that focus", () => {
    const focus = vi.fn();
    const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
    ref.current = { isConnected: true, focus } as unknown as HTMLElement;
    contentProps.length = 0;
    renderToStaticMarkup(h(OkrCheckInModal, { okrId: "g1", canEdit: true, onClose: () => {}, target: target(), returnFocus: ref }));
    renderToStaticMarkup(h(TargetEditor, { goal: editor, initial: { id: "kr1", title: "Demos", startValue: 0, targetValue: 40, unit: null, kpiId: null }, onClose: () => {}, returnFocus: ref }));
    expect(contentProps).toHaveLength(2);
    for (const p of contentProps) (p.onCloseAutoFocus as (e: Event) => void)({ preventDefault: () => {} } as unknown as Event);
    expect(focus).toHaveBeenCalledTimes(2);
  });
});

describe("M10: a picker's name starts with what it shows", () => {
  it("What, Counted by and KPI read value first", () => {
    const list = renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {},
      initial: { id: "kr1", title: "Demos", startValue: 0, targetValue: 40, unit: null, currentValue: 3, kpiId: null, listSource: { kind: "list", listIds: ["b1"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" } } }));
    expect(list).toContain('aria-label="Count of tasks, What"');
    expect(list).toContain('aria-label="Done date, Counted by"');
    const kpi = renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {}, initial: { title: "NPS", startValue: 0, targetValue: 60, unit: null, kpiId: "kpi-9" } }));
    expect(kpi).toMatch(/aria-label="[^"]*, KPI"/);
    expect(kpi).not.toContain("none chosen");
  });
});

describe("M11: the reminder rhythm never breaks out of its control at 390", () => {
  it("a segment never wraps", () => {
    const html = renderToStaticMarkup(h(SegmentedControl, { label: "Remind", value: "WEEKLY", onChange: () => {}, options: [{ value: "WEEKLY", label: "Weekly" }, { value: "BIWEEKLY", label: "Every two weeks" }] }));
    expect(html.match(/whitespace-nowrap/g)).toHaveLength(2);
  });
  it("below 640 the modal offers the same choices as a picker", () => {
    const html = renderToStaticMarkup(h(CreateGoalModal, { open: true, level: "INDIVIDUAL", onClose: () => {}, onSaved: () => {}, recurring: { on: true, settings: IST } }));
    expect(html).toMatch(/<span class="hidden sm:block"><div class="inline-flex[^"]*"><div role="radiogroup" aria-label="Remind the owner to check in"/);
    expect(html).toMatch(/<span class="sm:hidden"><span [^>]*><span id="[^"]+" hidden="">Remind the owner to check in<\/span><button [^>]*aria-haspopup="listbox"/);
  });
});

describe("L1: a count of what stands now says Right now", () => {
  it("the preview line and the hint", () => {
    expect(previewLineFor({ numbersOk: true, needsSource: false, countedNow: true, value: 10, start: 0, target: 200, unit: "rows", periodWord: "This month" })).toBe("Right now: 10 of 200 rows");
    expect(previewLineFor({ numbersOk: true, needsSource: false, countedNow: false, value: 10, start: 0, target: 200, unit: "rows", periodWord: "This month" })).toBe("This month so far: 10 of 200 rows");
    expect(rightNowHint("MONTHLY")).toBe("Its number on the period's last day becomes the result.");
    const html = renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {},
      initial: { id: "kr1", title: "Open roles", startValue: 0, targetValue: 200, unit: "rows", currentValue: 10, kpiId: null, tableSource: { kind: "table", tableId: "t1", metric: { op: "count" }, filters: [], countedBy: "now" } } }));
    expect(html).toContain("Right now: 10 of 200 rows");
    expect(html).not.toContain("Its number stands for the period");
  });
});

describe("L2, L3, L4: one name for Where, one heading for Which tasks, one line about filled rows", () => {
  const listInitial = { id: "kr1", title: "Demos", startValue: 0, targetValue: 40, unit: null, currentValue: 3, kpiId: null, listSource: { kind: "list", listIds: ["b1"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" } };
  it("a List target's source row is Where, with no inner Filter heading", () => {
    const html = renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {}, initial: listInitial }));
    expect(html).toContain('aria-label="Where"');
    expect(html).not.toContain("Data source");
    expect(html).toContain("Which tasks");
    expect(html).not.toContain(">Filter<");
    // A dashboard card keeps both.
    expect(renderToStaticMarkup(h(WidgetSourcePicker, { surface: "dashboard", source: { kind: "lists", listIds: [] }, onChange: () => {} }))).toContain("Data source");
    expect(renderToStaticMarkup(h(WidgetFilterEditor, { filter: { connector: "AND", rules: [], hideDone: false }, onChange: () => {}, listsSource: true, fields: [], statuses: [] }))).toContain(">Filter<");
  });
  it("a table target says only filled rows count once", () => {
    const html = renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {},
      initial: { id: "kr1", title: "Revenue", startValue: 0, targetValue: 1000, unit: null, currentValue: 250, kpiId: null, tableSource: { kind: "table", tableId: "t1", metric: { op: "count" }, filters: [], countedBy: "now" } } }));
    expect(html.match(/rows that hold data/g)).toHaveLength(1);
    expect(renderToStaticMarkup(h(TableFilterEditor, { columns: [{ id: "s", type: "select", label: "Stage", options: ["Won"] }], filters: [], onChange: () => {} }))).not.toContain("Every filled row");
  });
});

describe("L12: every goal dialog's Cancel is outlined", () => {
  it("the check-in, the target editor and the goal modal", () => {
    const outlined = /<button[^>]*class="[^"]*\bborder\b[^"]*"[^>]*>Cancel<\/button>/;
    expect(renderToStaticMarkup(h(OkrCheckInModal, { okrId: "g1", canEdit: true, onClose: () => {}, target: target() }))).toMatch(outlined);
    expect(renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {}, initial: { title: "Demos", startValue: 0, targetValue: 40, unit: null, kpiId: null } }))).toMatch(outlined);
    expect(renderToStaticMarkup(h(CreateGoalModal, { open: true, level: "INDIVIDUAL", onClose: () => {}, onSaved: () => {}, recurring: { on: true, settings: IST } }))).toMatch(outlined);
  });
});

describe("L13: Past periods keeps the value at 390", () => {
  it("the value is shown at every width; only the bar goes below 640", () => {
    const rows: PastPeriodRow[] = [{ key: "2026-09-01", label: "September 2026", shortLabel: "Sep", result: "HIT", resultLabel: "Hit", progress: 100, attainment: 112, single: { currentValue: 45, targetValue: 40, unit: "demos" } }];
    const html = renderToStaticMarkup(h(PastPeriods, { okrId: "g1", initial: { rows, total: 1 }, selectedKey: null, currentKey: null }));
    expect(html).toMatch(/<span class="shrink-0 whitespace-nowrap text-end[^"]*">45 of 40 demos<\/span>/);
    expect(html).not.toMatch(/<span class="hidden [^"]*">45 of 40 demos/);
  });
});

describe("L14: the period name is not a button that does nothing", () => {
  it("plain text between the arrows", () => {
    const html = renderToStaticMarkup(h(GoalPeriodControl, { okrId: "g1", choices: [{ key: "2026-10-01", label: "Q3 FY27" }], value: "2026-10-01", currentKey: "2026-10-01", aside: "1 Oct 2026 to 31 Dec 2026, 9 days left" }));
    const label = html.match(/<span class="([^"]*)" aria-live="polite">Q3 FY27<\/span>/);
    expect(label).not.toBeNull();
    expect(label![1]).not.toContain("border");
    expect(html).toContain("1 Oct 2026 to 31 Dec 2026, 9 days left");
  });
});

describe("L15: filter remove buttons say which filter, and the Remove List target is 24px", () => {
  it("names and sizes", () => {
    const widget = renderToStaticMarkup(h(WidgetFilterEditor, { filter: { connector: "AND", rules: [{ field: "status", operator: "is", value: "" }], hideDone: false } as never, onChange: () => {}, listsSource: true, fields: [], statuses: [] }));
    expect(widget).toContain('aria-label="Remove the Status filter"');
    expect(widget).not.toContain('title="Remove filter"');
    const table = renderToStaticMarkup(h(TableFilterEditor, { columns: [{ id: "s", type: "select", label: "Stage", options: ["Won"] }], filters: [{ colId: "s", kind: "value", values: [] }], onChange: () => {} }));
    expect(table).toContain('aria-label="Remove the Stage filter"');
    const lists = renderToStaticMarkup(h(WidgetSourcePicker, { surface: "goal", source: { kind: "lists", listIds: ["b1"] }, onChange: () => {} }));
    expect(lists).toMatch(/aria-label="Remove List" class="[^"]*\bh-6 w-6\b/);
  });
});

describe("L17: Home's goals card wraps a title below 640", () => {
  it("the title breaks words and truncates only from sm up", () => {
    expect(src("../../home/home-client.tsx")).toContain('<span className="min-w-0 flex-1 break-words py-1.5 text-ink sm:truncate sm:py-0">{g.title}</span>');
  });
});

describe("L19: Save never does nothing in silence", () => {
  it("the inline refusals are alerts and the footer says why Save did nothing", () => {
    const file = src("../../../../components/okrs/create-goal-modal.tsx");
    expect(file).toContain('<span role="alert" className="text-sm font-normal text-danger-text">{REPEAT_HAS_HISTORY_WORDS}</span>');
    expect(file).toContain('<span role="alert" className="text-sm font-normal text-danger-text">{KPI_WEEKLY}</span>');
    expect(file).toContain('{blockedPressed && blockedNow ? <p role="alert"');
    expect(file).toContain("if (blockedNow) setBlockedPressed(true);");
  });
});

describe("L20: hints are tied to their controls", () => {
  it("a SettingsRow hint describes the picker in it", () => {
    const html = renderToStaticMarkup(h(SettingsRow, { label: "What", hint: "None of the chosen Lists has a number field.",
      children: h(PickerButton, { label: "Count of tasks", ariaLabel: "Count of tasks, What", sections: [], onSelect: () => {} }) }));
    const id = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}" class="ps-[96px] text-xs text-ink-2">None of the chosen Lists has a number field.`);
    expect(renderToStaticMarkup(h(SettingsRow, { label: "Name", children: h(PickerButton, { label: "x", ariaLabel: "x", sections: [], onSelect: () => {} }) }))).not.toContain("aria-describedby");
  });
  it("the Starts picker is described by its dates", () => {
    const html = renderToStaticMarkup(h(CreateGoalModal, { open: true, level: "INDIVIDUAL", onClose: () => {}, onSaved: () => {}, recurring: { on: true, settings: IST }, initialRepeat: "MONTHLY" }));
    const at = html.indexOf(">Starts</span>");
    const id = html.slice(at).match(/<span id="[^"]+" hidden="">Starts<\/span><button [^>]*aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<span id="${id}" class="text-sm font-normal text-ink-2">1 Nov 2026 to 30 Nov 2026</span>`);
  });
});

describe("L21: Count again, the word its toast answers with", () => {
  it("the row menu of a sourced target", () => {
    const html = renderToStaticMarkup(h(GoalTargets, { okrId: "g1", canEdit: true, canCheckIn: true, editor, period: november, targets: [target({ source: listSource() })] }));
    expect(html).toContain("Count again");
    expect(html).not.toContain(">Refresh<");
  });
});

describe("L22: placeholders and the empty Part of read at 4.5:1 (ink-2)", () => {
  it("no ink-3 text in the editor, the filters or the goal modal's Part of", () => {
    const html = renderToStaticMarkup(h(TargetEditor, { goal: editor, onClose: () => {}, initial: { title: "Demos", startValue: 0, targetValue: 40, unit: null, kpiId: null } }));
    expect(html).toContain("placeholder:text-ink-2");
    expect(html).not.toContain("placeholder:text-ink-3");
    expect(renderToStaticMarkup(h(TableFilterEditor, { columns: [{ id: "t", type: "short_text", label: "Note" }], filters: [{ colId: "t", kind: "contains", value: "" }], onChange: () => {} }))).not.toContain("placeholder:text-ink-3");
    const modal = renderToStaticMarkup(h(CreateGoalModal, { open: true, level: "INDIVIDUAL", onClose: () => {}, onSaved: () => {}, recurring: { on: true, settings: IST } }));
    expect(modal).toContain('<span class="text-ink-2">Not part of another goal</span>');
  });
});
