// The Picker's opt-in settings behaviour (settings-cleanup Phase 1 fixes M1
// and M2), rendered open to static markup: what is asserted is what the
// browser receives on the first paint.

import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Picker, selectedRowIndex, type PickerOption } from "./picker";

const opts: PickerOption[] = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"].map((l) => ({ value: l.toLowerCase(), label: l }));
const render = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(h(Picker, { open: true, onClose: () => {}, onSelect: () => {}, sections: [{ options: opts }], ...extra }));
const activeOf = (s: string) => {
  const list = /<div id="([^"]+)" role="listbox"[^>]*aria-activedescendant="([^"]+)"/.exec(s);
  return list ? Number(list[2].slice(list[1].length + 1)) : -1;
};

describe("the highlight opens on the current value (M2)", () => {
  it("starts on the selected row with highlightSelected", () => {
    const s = render({ selected: "zeta", highlightSelected: true });
    expect(activeOf(s)).toBe(5);
    // The highlighted row is the checked one.
    expect(s).toMatch(/aria-selected="true" data-picker-idx="5"[^>]*class="[^"]*bg-hover/);
  });

  it("keeps the first row for every other caller, and for a value the list does not hold", () => {
    expect(activeOf(render({ selected: "zeta" }))).toBe(0);
    expect(activeOf(render({ selected: "nope", highlightSelected: true }))).toBe(0);
    expect(activeOf(render({ selected: ["zeta"], multi: true, highlightSelected: true }))).toBe(0);
  });

  it("selectedRowIndex reads a single value only", () => {
    expect(selectedRowIndex(opts, "gamma")).toBe(2);
    expect(selectedRowIndex(opts, ["gamma"])).toBe(0);
    expect(selectedRowIndex(opts, null)).toBe(0);
  });
});

describe("the listbox and the search field are named (M1)", () => {
  it("takes the caller's listbox id and label", () => {
    const s = render({ listboxId: "tz-listbox", ariaLabel: "Time zone", searchPlaceholder: "Search time zone" });
    expect(s).toContain('<div id="tz-listbox" role="listbox" aria-label="Time zone"');
    expect(s).toContain('aria-label="Search time zone" aria-controls="tz-listbox"');
  });

  it("names the listbox from a label on the page when given one", () => {
    const s = render({ listboxId: "f-listbox", ariaLabelledBy: "f-label" });
    expect(s).toContain('<div id="f-listbox" role="listbox" aria-labelledby="f-label"');
    expect(s).not.toMatch(/role="listbox" aria-label=/);
  });
});

describe("the first paint keeps the asked edge (autoPlace measures after)", () => {
  it("draws end-0 and below until placement is measured", () => {
    const s = render({ align: "end", autoPlace: true });
    expect(s).toMatch(/class="absolute z-\[61\][^"]* top-full mt-1 end-0/);
    expect(s).not.toContain("data-picker-placed");
  });
});
