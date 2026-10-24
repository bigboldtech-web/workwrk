// PickerSelect (settings-cleanup Phase 1 fixes H1, M1, M2, L1): the trigger
// as the browser receives it, and what it hands the one Picker. The Picker
// is stubbed so its props can be read; its own markup is tested in
// src/components/ui/picker.test.ts.

import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const seen: Record<string, unknown>[] = [];
vi.mock("@/components/ui/picker", () => ({
  Picker: (props: Record<string, unknown>) => {
    seen.push(props);
    return null;
  },
}));

import { EMPTY_VALUE_SENTINEL, PickerSelect, fromPickerValue, shouldReturnFocus, toPickerValue } from "./picker-select";

type Props = Parameters<typeof PickerSelect>[0];
const FLOOR = [{ value: "", label: "Everyone" }, { value: "MANAGER", label: "Managers and up" }];
function render(p: Partial<Props>) {
  seen.length = 0;
  const html = renderToStaticMarkup(h(PickerSelect, { value: "", options: FLOOR, onChange: () => {}, ...p } as Props));
  return { html, picker: seen[seen.length - 1] as { [k: string]: unknown; onSelect: (v: string) => void; sections: { options: { value: string }[] }[] } };
}

describe("the trigger's name carries the label and the value (M1)", () => {
  it("points aria-labelledby at a label element and the value element", () => {
    const { html } = render({ label: "Who can see Planner", value: "MANAGER" });
    const ids = /aria-labelledby="([^"]+)"/.exec(html)?.[1].split(" ") ?? [];
    expect(ids).toHaveLength(2);
    expect(html).toContain(`<span id="${ids[0]}" hidden="">Who can see Planner</span>`);
    expect(html).toContain(`<span id="${ids[1]}" class="min-w-0 truncate">Managers and up</span>`);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    // No listbox in the page while closed, so nothing to point at yet.
    expect(html).not.toContain("aria-controls=");
    expect(html).not.toContain("aria-label=");
  });

  it("reads the placeholder as the value when no option matches", () => {
    const { html } = render({ label: "Mute", value: "zzz", options: [{ value: "a", label: "A" }], placeholder: "Pick one" });
    expect(html).toMatch(/<span id="[^"]+-value" class="min-w-0 truncate">Pick one<\/span>/);
  });

  it("names the listbox and the search field from the label, and gives the listbox the id the trigger controls", () => {
    const { picker } = render({ label: "Time zone", id: "tz" });
    expect(picker.ariaLabel).toBe("Time zone");
    expect(picker.searchPlaceholder).toBe("Search time zone");
    expect(picker.listboxId).toBe("tz-listbox");
    expect(picker.ariaLabelledBy).toBeUndefined();
  });

  it("with only an id, is named by the Field label for that id", () => {
    const { html, picker } = render({ id: "loc-fiscal" });
    expect(html).toContain('aria-labelledby="loc-fiscal-label loc-fiscal-value"');
    expect(picker.ariaLabelledBy).toBe("loc-fiscal-label");
  });
});

describe("it opens where it is seen, on the current value (H1, L6, M2)", () => {
  it("asks the Picker to place itself and to start on the selected row", () => {
    const { picker } = render({ label: "L", align: "end" });
    expect(picker.autoPlace).toBe(true);
    expect(picker.highlightSelected).toBe(true);
    expect(picker.align).toBe("end");
  });
});

describe('an option whose value is "" shows as selected (L1)', () => {
  it("hands the Picker a sentinel for it, and turns it back on the way out", () => {
    const onChange = vi.fn();
    const { picker } = render({ label: "Who can see Planner", value: "", onChange });
    expect(picker.selected).toBe(EMPTY_VALUE_SENTINEL);
    expect(picker.sections[0].options.map((o) => o.value)).toEqual([EMPTY_VALUE_SENTINEL, "MANAGER"]);
    picker.onSelect("MANAGER");
    expect(onChange).toHaveBeenLastCalledWith("MANAGER");
    onChange.mockClear();
    picker.onSelect(EMPTY_VALUE_SENTINEL);
    expect(onChange).not.toHaveBeenCalled(); // already the value
    const again = render({ label: "L", value: "MANAGER", onChange });
    again.picker.onSelect(EMPTY_VALUE_SENTINEL);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("round-trips every other value unchanged", () => {
    expect(fromPickerValue(toPickerValue(""))).toBe("");
    expect(toPickerValue("MANAGER")).toBe("MANAGER");
    expect(fromPickerValue("MANAGER")).toBe("MANAGER");
  });
});

describe("focus goes back to the trigger (M2)", () => {
  const page = { isConnected: true };
  const inside = { isConnected: true };
  const elsewhere = { isConnected: true };
  const popover = { contains: (n: unknown) => n === inside };

  it("always after a choice", () => {
    expect(shouldReturnFocus("select", elsewhere, page, popover)).toBe(true);
  });

  it("after Esc or a click outside when focus is lost or still in the popover", () => {
    expect(shouldReturnFocus("dismiss", page, page, popover)).toBe(true);
    expect(shouldReturnFocus("dismiss", null, page, popover)).toBe(true);
    expect(shouldReturnFocus("dismiss", { isConnected: false }, page, popover)).toBe(true);
    expect(shouldReturnFocus("dismiss", inside, page, popover)).toBe(true);
  });

  it("not when focus has moved somewhere else (a dialog the choice opened)", () => {
    expect(shouldReturnFocus("dismiss", elsewhere, page, popover)).toBe(false);
  });

  it("after a click outside that only handed focus to a box holding the trigger (<main tabindex=-1>, the drawer)", () => {
    const trigger = { isConnected: true };
    const main = { isConnected: true, contains: (n: unknown) => n === trigger };
    expect(shouldReturnFocus("dismiss", main, page, popover, trigger)).toBe(true);
    // Another control does not hold the trigger: leave focus there.
    expect(shouldReturnFocus("dismiss", { isConnected: true, contains: () => false }, page, popover, trigger)).toBe(false);
  });

  it("a disabled control stays focusable, so a save or a confirm never drops focus to the page", () => {
    const { html } = render({ label: "L", disabled: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });
});
