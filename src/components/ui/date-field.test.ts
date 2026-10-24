// The shared date and time pickers' name and focus (settings-cleanup Phase 3
// review, M3), for every caller at once: Notifications' Mute until, Meetings'
// When row, the New meeting modal, the Event popover, every filter and form.
//
// The name: the trigger is named by its label AND the value it shows
// (aria-labelledby the hidden label, then the value span), never an
// aria-label laid over a value a screen reader then cannot read. Rendered to
// static markup, so what is asserted is what the browser receives.
//
// The focus: a pick, Esc and a click outside hand focus back to the trigger
// (ui/return-focus, the rule PickerSelect already kept), exercised against a
// stand-in document, and wired so in each picker's source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DateField } from "./date-field";
import { DateTimeField, TimeField } from "./date-time-field";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The trigger button (the first one that pops something up) and the ids its aria-labelledby names, in order. */
function trigger(html: string, popup: "dialog" | "listbox") {
  const tag = new RegExp(`<button[^>]*aria-haspopup="${popup}"[^>]*>`).exec(html)?.[0] ?? "";
  const ids = /aria-labelledby="([^"]+)"/.exec(tag)?.[1].split(" ") ?? [];
  /** The text of the element with this id. */
  const textOf = (id: string) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? null;
  return { tag, ids, name: ids.map(textOf).join(" ") };
}

describe("DateField: the trigger is named by its label and its date", () => {
  it("reads 'label value', the label a hidden span and the date the visible one", () => {
    const html = renderToStaticMarkup(h(DateField, { value: "2026-10-25", onChange: () => {}, ariaLabel: "Due date" }));
    const t = trigger(html, "dialog");
    expect(t.tag).not.toContain("aria-label=");
    expect(t.ids).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<span id="${t.ids[0]}" hidden="">Due date</span>`));
    expect(t.name).toMatch(/^Due date \S/);
    // The second id is the date the trigger shows ("25 Oct", with the year once it is not this year's).
    expect(t.name).toMatch(/^Due date (25 Oct|Oct 25)/);
  });

  it("reads 'label placeholder' with no date, and its content alone with no label", () => {
    const empty = trigger(renderToStaticMarkup(h(DateField, { value: null, onChange: () => {}, ariaLabel: "From", placeholder: "Any" })), "dialog");
    expect(empty.name).toBe("From Any");
    const bare = trigger(renderToStaticMarkup(h(DateField, { value: null, onChange: () => {} })), "dialog");
    expect(bare.tag).not.toContain("aria-labelledby");
    expect(bare.tag).not.toContain("aria-label=");
  });

  it("gives two fields on one page ids of their own", () => {
    const html = renderToStaticMarkup(
      h("div", null, h(DateField, { value: null, onChange: () => {}, ariaLabel: "From" }), h(DateField, { value: null, onChange: () => {}, ariaLabel: "To" })),
    );
    const ids = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].flatMap((m) => m[1].split(" "));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("TimeField and DateTimeField: each trigger is named by its label and its value", () => {
  it("TimeField reads 'label time'", () => {
    const t = trigger(renderToStaticMarkup(h(TimeField, { value: "09:00", onChange: () => {}, label: "Start" })), "listbox");
    expect(t.tag).not.toContain("aria-label=");
    expect(t.name).toMatch(/^Start 9[:.]00/);
  });

  it("DateTimeField names its date half and its time half, each with the value it shows", () => {
    const html = renderToStaticMarkup(h(DateTimeField, { value: "2026-10-25T15:00", onChange: () => {}, label: "Mute until" }));
    const date = trigger(html, "dialog");
    const time = trigger(html, "listbox");
    expect(date.name).toMatch(/^Mute until: date \S/);
    expect(time.name).toMatch(/^Mute until: time (3[:.]00|15[:.]00)/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Mute until: (date|time)"/);
  });

  it("reads Pick a time while no time is set", () => {
    const html = renderToStaticMarkup(h(DateTimeField, { value: "", onChange: () => {}, label: "When" }));
    expect(trigger(html, "listbox").name).toBe("When: time Pick a time");
  });
});

describe("returnFocusOnClose: focus goes back to the trigger when a picker closes", () => {
  const realDocument = globalThis.document;
  const realWindow = globalThis.window;
  afterEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, { document: realDocument, window: realWindow });
  });

  /** A page whose focused element is `active`, a trigger that records focus, and the box that holds them. */
  function stage(active: "page" | "gone" | "inside" | "elsewhere") {
    vi.useFakeTimers();
    const body = { isConnected: true, contains: () => true };
    const trigger = { isConnected: true, focus: vi.fn(), contains: () => false };
    const inside = { isConnected: true, contains: () => false };
    const elsewhere = { isConnected: true, contains: () => false };
    const scope = { contains: (n: unknown) => n === trigger || n === inside };
    type Focusable = { isConnected: boolean; contains?: (n: unknown) => boolean };
    const doc: { body: Focusable; activeElement: Focusable } = { body, activeElement: active === "page" ? body : active === "gone" ? { isConnected: false } : active === "inside" ? inside : elsewhere };
    Object.assign(globalThis, { document: doc, window: { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) } });
    return { trigger, scope, doc };
  }

  it("after a pick, always, even with focus inside the popover that is going away", async () => {
    const { returnFocusOnClose } = await import("./return-focus");
    const { trigger, scope } = stage("inside");
    returnFocusOnClose("select", trigger, scope);
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("after Esc or a click outside, when focus was lost to the page or went with the popover", async () => {
    const { returnFocusOnClose } = await import("./return-focus");
    for (const where of ["page", "gone", "inside"] as const) {
      const { trigger, scope } = stage(where);
      returnFocusOnClose("dismiss", trigger, scope);
      expect(trigger.focus, where).toHaveBeenCalled();
    }
  });

  it("never takes focus from another control, such as a dialog the choice opened", async () => {
    const { returnFocusOnClose } = await import("./return-focus");
    const { trigger, scope } = stage("elsewhere");
    returnFocusOnClose("dismiss", trigger, scope);
    vi.runAllTimers();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("looks again once the click-out catcher has moved focus to the box that holds the trigger", async () => {
    const { returnFocusOnClose } = await import("./return-focus");
    const { trigger, scope, doc } = stage("elsewhere");
    returnFocusOnClose("dismiss", trigger, scope);
    expect(trigger.focus).not.toHaveBeenCalled();
    // The catcher's mousedown hands focus to <main tabindex=-1>, which holds the trigger.
    doc.activeElement = { isConnected: true, contains: (n: unknown) => n === trigger };
    vi.runAllTimers();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("is the rule PickerSelect keeps, from the one place", async () => {
    const { shouldReturnFocus } = await import("./return-focus");
    const select = await import("@/components/settings/picker-select");
    expect(select.shouldReturnFocus).toBe(shouldReturnFocus);
  });
});

describe("each picker hands focus back on a pick, Esc and a click outside", () => {
  const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  it("DateField: a day or a chip, Esc (its layer) and the catcher all close through returnFocusOnClose; the clear X refocuses the field", () => {
    const s = code("src/components/ui/date-field.tsx");
    expect(s).toContain('import { idToken, returnFocusOnClose } from "@/components/ui/return-focus";');
    expect(s).toMatch(/const close = useCallback\(\(reason: "select" \| "dismiss"\) => \{\s*setOpen\(false\);\s*if \(!inline\) returnFocusOnClose\(reason, triggerRef\.current, wrapRef\.current\);\s*\}, \[inline\]\);/);
    expect(s).toContain('useLayer(open && !inline, { kind: "popover", close: () => close("dismiss") });');
    expect(s).toContain('const pick = (d: Date | null) => { onChange(d ? toDateKey(d) : null); close("select"); };');
    expect(s).toContain('onMouseDown={() => close("dismiss")}');
    expect(s).not.toContain("onMouseDown={() => setOpen(false)}");
    expect(s).toContain("onClick={() => { onChange(null); triggerRef.current?.focus({ preventScroll: true }); }}");
    expect(s).toMatch(/<button\s+ref=\{triggerRef\}/);
    expect(s).toMatch(/<span ref=\{wrapRef\} className=\{cn\("relative block", className\)\}>/);
  });

  it("TimeField (and so DateTimeField's time half): a pick and the Picker's close both go through returnFocusOnClose", () => {
    const s = code("src/components/ui/date-time-field.tsx");
    expect(s).toMatch(/const close = useCallback\(\(reason: "select" \| "dismiss"\) => \{\s*setOpen\(false\);\s*returnFocusOnClose\(reason, triggerRef\.current, wrapRef\.current\);\s*\}, \[\]\);/);
    expect(s).toContain('onClose={() => close("dismiss")}');
    expect(s).toContain('onSelect={(v) => { close("select"); onChange(v); }}');
    // The time half is TimeField itself, so the two time triggers cannot drift apart.
    expect(s).toContain("<TimeField value={time} onChange={setTime} label={`${label}: time`} disabled={disabled} />");
    expect(s.match(/<Picker\b/g)).toHaveLength(1);
  });
});
