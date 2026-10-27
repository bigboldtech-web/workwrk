// The goal modal's Goal type block (docs/plans/recurring-goals.md A2, A3, 2.0),
// rendered to static markup: what is asserted is what the browser receives
// on the first paint. The Dialog is unwrapped (Radix portals render nothing
// on the server) and the Picker is stubbed so the Starts and Ends choices it
// is handed can be read.
//
// THE CONTRACT: Repeating renders NO Due date field and its save carries no
// due date; One time keeps the required Due date ("Pick a due date."); with
// the RECURRING_GOALS switch off nothing new renders.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const pickers: Array<{ ariaLabel?: string; sections: Array<{ options: Array<{ value: string; label: string; description?: string }> }> }> = [];

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u-1" } } }) }));
vi.mock("@/components/ui/dialog-provider", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/ui/dialog", () => {
  const pass = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Dialog: pass, DialogContent: pass, DialogHeader: pass, DialogTitle: pass, DialogFooter: pass, DialogDescription: pass };
});
vi.mock("@/components/ui/picker", () => ({
  Picker: (props: { ariaLabel?: string; sections: Array<{ options: Array<{ value: string; label: string; description?: string }> }> }) => {
    pickers.push(props);
    return null;
  },
}));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => ({ ok: false, error: "not in a test" }) }));

import { CreateGoalModal, type EditableGoal } from "./create-goal-modal";
import type { PeriodSettings } from "@/lib/goals/goal-period";

const IST: PeriodSettings = { timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 };
const OCT27 = new Date(Date.UTC(2026, 9, 27, 12) - 330 * 60_000);

type Props = Parameters<typeof CreateGoalModal>[0];
function render(p: Partial<Props>) {
  pickers.length = 0;
  return renderToStaticMarkup(h(CreateGoalModal, { open: true, level: "INDIVIDUAL", onClose: () => {}, onSaved: () => {}, ...p } as Props));
}
const ON = { on: true, settings: IST };
const OFF = { on: false, settings: null };
const pickerFor = (label: string) => pickers.find((p) => p.ariaLabel === label);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(OCT27);
});
afterEach(() => vi.useRealTimers());

describe("Repeating renders no Due date field (A2)", () => {
  it("Repeating: Repeats every, Starts, Ends and the reminder, and no Due date or Start date", () => {
    const html = render({ recurring: ON, initialRepeat: "MONTHLY" });
    expect(html).toContain("Goal type");
    expect(html).toContain("Repeats every");
    expect(html).toContain("Targets start fresh on the 1st of every month. Past months keep their results.");
    expect(html).toContain(">Starts<");
    expect(html).toContain(">Ends<");
    expect(html).toContain("Remind the owner to check in");
    expect(html).not.toContain("Due date");
    expect(html).not.toContain("Start date");
    expect(html).not.toContain("Check-ins<");
  });

  it("Starts offers this month with '4 days left' and defaults to November by the half rule; Ends starts at Never", () => {
    const html = render({ recurring: ON, initialRepeat: "MONTHLY" });
    const starts = pickerFor("Starts")!;
    expect(starts.sections[0].options[0]).toMatchObject({ value: "2026-10-01", label: "October, 4 days left" });
    expect(html).toContain("November 2026");
    expect(html).toContain("1 Nov 2026 to 30 Nov 2026");
    const ends = pickerFor("Ends")!;
    expect(ends.sections[0].options[0].label).toBe("Never");
    expect(ends.sections[0].options[1].label).toBe("Last period: December 2026");
  });

  it("One time keeps Start date and the required Due date", () => {
    const html = render({ recurring: ON });
    expect(html).toContain("Goal type");
    expect(html).toContain("Start date");
    expect(html).toContain("Due date");
    expect(html).not.toContain("Repeats every");
  });

  it("the save path reads the shared rules, which leave a repeating goal's due date out (the old modal refused with 'Pick a due date.')", () => {
    const src = readFileSync(new URL("./create-goal-modal.tsx", import.meta.url), "utf8");
    expect(src).toContain("validateGoalDates({ type, startDate, endDate })");
    expect(src).toContain("...goalDatesPayload(");
    // The old unconditional refusal is gone: only goal-form.ts says it, and only for One time.
    expect(src).not.toContain('errs.endDate = "Pick a due date."');
  });
});

describe("with the RECURRING_GOALS switch off nothing new renders (2.0)", () => {
  it("no Goal type, no Repeats every; Check-ins with None, and the Due date as today", () => {
    const html = render({ recurring: OFF });
    expect(html).not.toContain("Goal type");
    expect(html).not.toContain("Repeats every");
    expect(html).not.toContain("Remind the owner to check in");
    expect(html).toContain("Check-ins");
    expect(html).toContain(">None<");
    expect(html).not.toContain(">Off<");
    expect(html).toContain("Due date");
  });

  it("even asked to open on Repeating, it stays a one-time form", () => {
    const html = render({ recurring: OFF, initialRepeat: "MONTHLY" });
    expect(html).not.toContain("Goal type");
    expect(html).toContain("Due date");
  });

  it("a goal that already repeats keeps its Repeats, and grows no Due date the save would refuse", () => {
    const goal: EditableGoal = { id: "g1", title: "Demos", level: "INDIVIDUAL", repeat: "MONTHLY", repeatUntil: null, startDate: "2026-10-01T00:00:00.000Z", endDate: null, checkInCadence: "WEEKLY" };
    const html = render({ recurring: OFF, goal });
    expect(html).not.toContain("Goal type");
    expect(html).toContain("Repeats monthly");
    expect(html).not.toContain("Due date");
  });
});

describe("edit (A3)", () => {
  it("a repeating goal opens on Repeating with its cadence", () => {
    const goal: EditableGoal = { id: "g1", title: "Demos", level: "INDIVIDUAL", repeat: "QUARTERLY", repeatUntil: null, startDate: "2026-10-01T00:00:00.000Z", endDate: null, checkInCadence: "MONTHLY" };
    const html = render({ recurring: ON, goal });
    expect(html).toContain("Repeats every");
    expect(html).toMatch(/aria-checked="true"[^>]*>Quarter</);
    expect(html).toMatch(/aria-checked="true"[^>]*>Repeating</);
    expect(html).not.toContain("Due date");
  });
});
