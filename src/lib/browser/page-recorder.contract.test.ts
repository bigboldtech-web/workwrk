// The recorder's source held to its contract (src/lib/browser/page-recorder.ts,
// docs/plans/ai-teammates-phase5.md Decision 7, step 2), read as text: it
// reads no value, no chosen option, no typed data, no key but whether it is
// Enter, no editable region's or combobox's words, no selection and no
// clipboard; every listener returns at once unless the recorder is on and the
// event trusted; the typing mark is set by the person's own pointer or key
// and cleared only at focusout, never at focusin; and the body installs once
// a world. The script also runs: in a page double, the person's marked typing
// counts, a script's focus() then execCommand does not, a suggestion and an
// echo carry no words, and a second start adds no second set of listeners.

import { describe, expect, it } from "vitest";
import { NAMING_SOURCE, READER_SOURCE } from "./page-reader";
import { RECORDER_BINDING, RECORDER_CALL, RECORDER_SOURCE, RECORDER_WORLD } from "./page-recorder";

/** The recorder's own lines: its source less the reader's naming fragment it includes. */
const OWN = RECORDER_SOURCE.replace(NAMING_SOURCE, "");

describe("the recorder's source (Decision 7)", () => {
  it("is a world of its own, never the reader's, and includes the reader's naming rules whole", () => {
    expect(RECORDER_WORLD).toBe("wk-recorder");
    expect(RECORDER_SOURCE).toContain(NAMING_SOURCE);
    expect(RECORDER_CALL).toContain(NAMING_SOURCE);
    // The reader keeps them too: one fragment, so the two never name a control apart.
    expect(READER_SOURCE).toContain(NAMING_SOURCE);
    expect(OWN.length).toBeLessThan(RECORDER_SOURCE.length);
  });

  it("reads no value, ticked box, chosen option, typed data, editable or combobox words, selection or clipboard, and no filledOf", () => {
    for (const src of [RECORDER_SOURCE, RECORDER_CALL]) {
      for (const banned of [/\.value\b/, /\.checked\b/, /\.selectedIndex\b/, /\.selectedOptions\b/, /\.data\b/, /innerText/, /getSelection/, /clipboard/i, /filledOf/, /isEmptyField/, /\.text\b/, /\.label\b/]) {
        expect(banned.test(src), String(banned)).toBe(false);
      }
    }
    // textContent only in the reader's two label hints (a label's, an aria-labelledby target's), never the recorder's own lines.
    expect(OWN.includes("textContent")).toBe(false);
    const lines = NAMING_SOURCE.split("\n").filter((l) => l.includes("textContent"));
    expect(lines.every((l) => /ls\[i\]\.textContent|t\.textContent/.test(l))).toBe(true);
  });

  it("returns at once from every listener unless the recorder is on and the event trusted", () => {
    const listeners = [...OWN.matchAll(/win\.addEventListener\("([a-z]+)", function \(e\) \{\n\s*([^\n]+)/g)];
    expect(listeners.map((m) => m[1]).sort()).toEqual(["blur", "change", "click", "focusout", "input", "keydown", "pointerdown"]);
    for (const m of listeners) expect(m[2].trim(), m[1]).toBe("if (!rec.on || !e.isTrusted) return;");
    // The observer's first line too: it records nothing while off.
    expect(OWN).toMatch(/new MutationObserver\(function \(list\) \{\n\s*if \(!rec\.on\) return;/);
  });

  it("reads a key only for whether it is Enter", () => {
    const keys = [...RECORDER_SOURCE.matchAll(/\.key\b[^s]/g)];
    expect(keys).toHaveLength(1);
    expect(RECORDER_SOURCE).toContain('e.key === "Enter"');
  });

  it("marks a field by the person's pointerdown or keydown, and clears the mark only at its focusout, never at focusin", () => {
    expect(OWN).not.toMatch(/focusin/);
    const marks = [...OWN.matchAll(/\bmark\(/g)].length;
    // The function itself, and its two callers: pointerdown and keydown.
    expect(marks).toBe(3);
    const pointer = OWN.slice(OWN.indexOf('addEventListener("pointerdown"'), OWN.indexOf('addEventListener("keydown"'));
    expect(pointer).toContain("mark(fieldOf(targetOf(e)))");
    const key = OWN.slice(OWN.indexOf('addEventListener("keydown"'), OWN.indexOf('addEventListener("focusout"'));
    expect(key).toContain("mark(f)");
    const out = OWN.slice(OWN.indexOf('addEventListener("focusout"'), OWN.indexOf('addEventListener("input"'));
    expect(out).toContain("rec.marks.delete(f)");
    expect([...OWN.matchAll(/rec\.marks\.delete\(/g)]).toHaveLength(1);
    // Typing counts only in a marked field.
    const input = OWN.slice(OWN.indexOf('addEventListener("input"'), OWN.indexOf('addEventListener("change"'));
    expect(input).toContain("!rec.marks.has(f)");
  });

  it("installs only when its world holds no __wkRec yet, before any listener", () => {
    const check = RECORDER_SOURCE.indexOf("if (g.__wkRec) return g.__wkRec.how;");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(RECORDER_SOURCE.indexOf("addEventListener("));
    expect(RECORDER_SOURCE).toContain('("new_document");');
    expect(RECORDER_CALL).toContain('install("late")');
  });

  it("sends each event through its world's binding, carrying the recording's token, else queues it", () => {
    expect(OWN).toContain(`g["${RECORDER_BINDING}"]`);
    expect(OWN).toContain("JSON.stringify({ t: rec.token, e: ev })");
  });
});

// ── The script itself, run in a page double ─────────────────────────

type Listener = (e: Record<string, unknown>) => void;

/** A page as far as the recorder's own lines touch it, the reader's naming rules answered by a stub. */
function pageDouble() {
  const listeners = new Map<string, Listener[]>();
  const sent: string[] = [];
  const field = (id: string, label: string) => ({ nodeType: 1, tagName: "INPUT", id, label, getAttribute: (n: string) => (n === "type" ? "text" : n === "id" ? id : null), parentElement: null, isContentEditable: false, maxLength: -1, form: null, matches: () => false, hasAttribute: () => false, contains: () => false });
  const amount = field("amount", "Amount");
  const notes = field("notes", "Notes");
  const g: Record<string, unknown> = {
    window: {} as Record<string, unknown>,
    document: { forms: [], documentElement: { nodeType: 1 }, body: null, activeElement: null, querySelectorAll: () => [] },
    location: { href: "http://expenses.proof.test/new" },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    CSS: { escape: (s: string) => s },
  };
  const win = g.window as Record<string, unknown>;
  win.top = win;
  win.addEventListener = (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  win.getComputedStyle = () => ({ cursor: "auto" });
  g[RECORDER_BINDING] = (payload: string) => sent.push(payload);
  return { g, listeners, sent, amount, notes };
}

/**
 * Run the recorder's body in the double: the naming fragment is swapped for a
 * stub that names a field by its label, so only the recorder's own lines run.
 */
function install(d: ReturnType<typeof pageDouble>) {
  const stub = `
    function roleOf() { return "textbox"; }
    function nameOf(el) { return el.label || ""; }
    function labelHint(el) { return el.label || ""; }
    function labelText(el) { return el.label || ""; }
    function labelledBy() { return ""; }
    function visibleText() { return ""; }
    function formOf() { return null; }
    function formAction() { return null; }
    function codeBoxesOf() { return null; }
    function editable() { return false; }
    function clean(s) { return String(s || "").trim(); }
    function kids() { return []; }
    function up() { return null; }
    var ROLES = { textbox: 1, button: 1 }, BUTTON_TYPES = {};
  `;
  const body = RECORDER_CALL.replace(NAMING_SOURCE, stub);
  const fn = new Function("globalThis", "window", "document", "location", "MutationObserver", "CSS", `return (${body});`)(d.g, d.g.window, d.g.document, d.g.location, d.g.MutationObserver, d.g.CSS) as (op: string, token: string | null) => Record<string, unknown>;
  return fn;
}

const ev = (type: string, target: unknown, o: Record<string, unknown> = {}) => ({ type, isTrusted: true, target, composedPath: () => [target], ...o });

describe("the recorder's own lines, run (Decision 7)", () => {
  it("counts the person's marked typing, never a script's focus() then execCommand, and sends no character of it", () => {
    const d = pageDouble();
    const call = install(d);
    expect(call("start", "tok")).toEqual({ installed: "late" });
    const fire = (type: string, e: Record<string, unknown>) => (d.listeners.get(type) ?? []).forEach((f) => f(e));
    // The person: a pointerdown on Amount, then typing (input events carry no text here, and none is read).
    fire("pointerdown", ev("pointerdown", d.amount));
    fire("input", ev("input", d.amount, { data: "42.50" }));
    // A script: focus() on Notes makes no mark, so its execCommand's trusted input is not counted.
    fire("input", ev("input", d.notes, { data: "Paste your recovery key" }));
    // An untrusted event: nothing.
    fire("pointerdown", { ...ev("pointerdown", d.notes), isTrusted: false });
    fire("input", ev("input", d.notes));
    const out = d.sent.map((s) => JSON.parse(s));
    expect(out.map((m) => [m.t, m.e.type, m.e.control.name])).toEqual([["tok", "input", "Amount"]]);
    expect(d.sent.join("")).not.toMatch(/42\.50|recovery/);
  });

  it("keeps the mark through the focus a click causes, and clears it at the field's focusout", () => {
    const d = pageDouble();
    const call = install(d);
    call("start", "tok");
    const fire = (type: string, e: Record<string, unknown>) => (d.listeners.get(type) ?? []).forEach((f) => f(e));
    fire("pointerdown", ev("pointerdown", d.notes));
    // Before (spec review 2, finding 2): clearing at focusin erased the mark the click had just set.
    fire("focusin", ev("focusin", d.notes));
    fire("input", ev("input", d.notes));
    fire("focusout", ev("focusout", d.notes));
    fire("input", ev("input", d.notes));
    expect(d.sent.map((s) => JSON.parse(s).e.type)).toEqual(["input"]);
  });

  it("installs its listeners once a world, starts with an empty queue, and records nothing once stopped", () => {
    const d = pageDouble();
    const call = install(d);
    call("start", null);
    const count = [...d.listeners.values()].reduce((n, l) => n + l.length, 0);
    const fire = (type: string, e: Record<string, unknown>) => (d.listeners.get(type) ?? []).forEach((f) => f(e));
    // No token (no binding yet): queued, handed over by drain.
    fire("pointerdown", ev("pointerdown", d.amount));
    fire("input", ev("input", d.amount));
    expect((call("drain", null).events as unknown[]).length).toBe(1);
    // A second start in the same world: no second set of listeners, the queue emptied.
    fire("input", ev("input", d.amount));
    call("start", "tok");
    expect([...d.listeners.values()].reduce((n, l) => n + l.length, 0)).toBe(count);
    expect(call("drain", null).events).toEqual([]);
    call("stop", null);
    fire("pointerdown", ev("pointerdown", d.amount));
    fire("input", ev("input", d.amount));
    expect(d.sent).toEqual([]);
    expect(call("drain", null).events).toEqual([]);
  });

  it("hands over what it queued before its binding at ensure, then sends through the binding", () => {
    const d = pageDouble();
    const call = install(d);
    call("start", null);
    const fire = (type: string, e: Record<string, unknown>) => (d.listeners.get(type) ?? []).forEach((f) => f(e));
    fire("pointerdown", ev("pointerdown", d.amount));
    fire("input", ev("input", d.amount));
    const out = call("ensure", "tok");
    expect((out.events as unknown[]).length).toBe(1);
    fire("pointerdown", ev("pointerdown", d.notes));
    fire("input", ev("input", d.notes));
    expect(d.sent.map((s) => JSON.parse(s).e.control.name)).toEqual(["Notes"]);
  });
});
