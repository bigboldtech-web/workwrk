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
// And in a DOM double (review of Phase 5 step 2): a field typed key by key is
// one event through the binding; an opener is named by its label, never the
// value it shows, and is no other control's label; a label that echoed the
// typing names nothing; a control inside an editable region keeps its role
// only; a label with no control is still a click; every hint is capped.

import { describe, expect, it, vi } from "vitest";
import { stepsFromRecording } from "@/lib/skills/steps";
import { recordedEventsFrom } from "./cdp-driver";
import { NAMING_SOURCE, READER_SOURCE } from "./page-reader";
import { RECORDER_CALL, RECORDER_SOURCE, RECORDER_WORLD, recorderBinding } from "./page-recorder";

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

  it("sends each event through its world's binding, by the name its recording was given, carrying the recording's token, else queues it", () => {
    expect(OWN).toContain("g[rec.binding]");
    expect(OWN).toContain("JSON.stringify({ t: rec.token, e: ev })");
    // Final races review, M1: no fixed name, which an earlier recording's removal would cut.
    expect(OWN).not.toContain("__wkRecOut\"");
    expect(recorderBinding("3f2a-b9")).toBe("__wkRecOut_3f2ab9");
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
  g[recorderBinding("tok")] = (payload: string) => sent.push(payload);
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
  const fn = new Function("globalThis", "window", "document", "location", "MutationObserver", "CSS", `return (${body});`)(d.g, d.g.window, d.g.document, d.g.location, d.g.MutationObserver, d.g.CSS) as (op: string, token: string | null, binding: string | null) => Record<string, unknown>;
  // The driver gives each recording's binding by its token (cdp-driver.ts).
  return (op: string, token: string | null) => fn(op, token, token ? recorderBinding(token) : null);
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

  it("sends through the binding its own recording was given, never another name in its world (final races review, M1)", () => {
    const d = pageDouble();
    const call = install(d);
    const old: string[] = [];
    // An earlier recording's binding, and the pre-M1 fixed name, both still in the world.
    d.g[recorderBinding("old")] = (p: string) => old.push(p);
    d.g.__wkRecOut = (p: string) => old.push(p);
    call("start", "tok");
    const fire = (type: string, e: Record<string, unknown>) => (d.listeners.get(type) ?? []).forEach((f) => f(e));
    fire("pointerdown", ev("pointerdown", d.amount));
    fire("input", ev("input", d.amount));
    // Before: sent through the one fixed name, whichever recording's it was.
    expect(d.sent.map((x) => JSON.parse(x).t)).toEqual(["tok"]);
    expect(old).toEqual([]);
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

// ── The recorder in a DOM double (review of Phase 5 step 2) ─────────

/** An element as far as the recorder's own lines touch it; `words` are its own text, its children's added. */
class El {
  nodeType = 1;
  children: El[] = [];
  parentElement: El | null = null;
  labels: El[] = [];
  control: El | null = null;
  isContentEditable = false;
  form = null;
  maxLength = -1;
  /** Its computed cursor (the double does not inherit it: a test sets it on each box a pointer cursor covers). */
  cursor = "auto";
  constructor(
    public tagName: string,
    public attrs: Record<string, string> = {},
    public words = "",
    private readonly root: { doc: unknown } = { doc: null },
  ) {}
  get id(): string {
    return this.attrs.id ?? "";
  }
  getAttribute(n: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
  }
  hasAttribute(n: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, n);
  }
  append(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  contains(o: El | null): boolean {
    for (let e = o; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
  matches(sel: string): boolean {
    return sel.split(",").some((part) => {
      const s = part.trim();
      let m: RegExpExecArray | null;
      if (/^[a-z]+$/.test(s)) return this.tagName.toLowerCase() === s;
      if ((m = /^\[([a-z-]+)=([a-z]+)\]$/.exec(s))) return this.getAttribute(m[1]) === m[2];
      if ((m = /^\[([a-z-]+)~="([^"]+)"\]$/.exec(s))) return (this.getAttribute(m[1]) ?? "").split(/\s+/).includes(m[2]);
      if ((m = /^\[([a-z-]+)\]$/.exec(s))) return this.hasAttribute(m[1]);
      throw new Error(`the double reads no selector ${s}`);
    });
  }
  querySelectorAll(sel: string): El[] {
    const out: El[] = [];
    const walk = (e: El) => {
      for (const k of e.children) {
        if (k.matches(sel)) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  getRootNode(): unknown {
    return this.root.doc;
  }
}

/** The naming rules, answered from the double: shown words are an element's words and its children's; a field is named by its labels. */
const DOM_NAMING = `
  function clean(s) { return String(s || "").replace(/\\s+/g, " ").trim(); }
  function visibleText(el, limit) { var out = el.words || ""; for (var i = 0; i < el.children.length; i++) out += " " + visibleText(el.children[i], limit); return clean(out).slice(0, limit); }
  function labelText(el) { var ls = el.labels || [], p = []; for (var i = 0; i < ls.length; i++) p.push(visibleText(ls[i], 300)); return clean(p.join(" ")); }
  function labelHint(el) { return labelText(el); }
  function labelledBy() { return ""; }
  function roleOf(el) {
    var r = (el.getAttribute("role") || "").trim();
    if (r && ROLES[r]) return r;
    var t = el.tagName;
    if (t === "A") return "link";
    if (t === "BUTTON") return "button";
    if (t === "TEXTAREA") return "textbox";
    if (t === "INPUT") { var ty = el.getAttribute("type") || "text"; return ty === "radio" ? "radio" : ty === "checkbox" ? "checkbox" : "textbox"; }
    return r || "other";
  }
  function nameOf(el) { var t = el.tagName; return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" ? labelText(el) : visibleText(el, 300); }
  function formOf() { return null; }
  function formAction() { return null; }
  function codeBoxesOf() { return null; }
  function editable(el) { return !!el.isContentEditable; }
  function kids(n) { return n.children || []; }
  function up(e) { return e.parentElement; }
  var ROLES = { button: 1, link: 1, checkbox: 1, radio: 1, option: 1, listbox: 1, combobox: 1, menuitem: 1, "switch": 1, textbox: 1 }, BUTTON_TYPES = {};
`;

type Mutation = { type: "childList" | "characterData" | "attributes"; target: unknown; addedNodes?: unknown[]; attributeName?: string; oldValue?: string | null };

/** A page of El elements under one body, with the recorder's binding, listeners and observer exposed. */
function domDouble() {
  const listeners = new Map<string, Listener[]>();
  const sent: string[] = [];
  let observed: ((list: Mutation[]) => void) | null = null;
  const root: { doc: unknown } = { doc: null };
  const html = new El("HTML", {}, "", root);
  const body = new El("BODY", {}, "", root);
  html.append(body);
  const doc = {
    forms: [],
    documentElement: html,
    body,
    activeElement: null,
    getElementById: (id: string) => html.querySelectorAll("[id]").find((e) => e.id === id) ?? null,
    querySelector: (sel: string) => html.querySelector(sel),
    querySelectorAll: (sel: string) => html.querySelectorAll(sel),
  };
  root.doc = doc;
  const g: Record<string, unknown> = {
    window: {} as Record<string, unknown>,
    document: doc,
    location: { href: "http://expenses.proof.test/edit" },
    MutationObserver: class {
      constructor(fn: (list: Mutation[]) => void) {
        observed = fn;
      }
      observe() {}
      disconnect() {}
    },
    CSS: { escape: (s: string) => s },
  };
  const win = g.window as Record<string, unknown>;
  win.top = win;
  win.addEventListener = (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  win.getComputedStyle = (e: El) => ({ cursor: e?.cursor ?? "auto" });
  g[recorderBinding("tok")] = (payload: string) => sent.push(payload);
  const el = (tag: string, attrs: Record<string, string> = {}, words = "") => new El(tag.toUpperCase(), attrs, words, root);
  /** A field and its label, the label's words its name. */
  const field = (tag: string, attrs: Record<string, string>, label: string) => {
    const f = el(tag, attrs);
    const l = el("label", {}, label);
    l.control = f;
    f.labels = [l];
    return { f, l };
  };
  const call = (() => {
    const body2 = RECORDER_CALL.replace(NAMING_SOURCE, DOM_NAMING);
    const fn = new Function("globalThis", "window", "document", "location", "MutationObserver", "CSS", `return (${body2});`)(g, g.window, g.document, g.location, g.MutationObserver, g.CSS) as (op: string, token: string | null, binding: string | null) => Record<string, unknown>;
    // The driver gives each recording's binding by its token (cdp-driver.ts), unless the test names one.
    return (op: string, token: string | null, binding?: string | null) => fn(op, token, binding !== undefined ? binding : token ? recorderBinding(token) : null);
  })();
  const fire = (type: string, target: El, o: Record<string, unknown> = {}) => (listeners.get(type) ?? []).forEach((f) => f({ type, isTrusted: true, target, composedPath: () => [target], ...o }));
  const mutate = (list: Mutation[]) => observed?.(list);
  const events = () => sent.map((s) => JSON.parse(s) as { t: string; e: { type: string; page: string; control: Record<string, unknown> | null } });
  return { g, body, el, field, call, fire, mutate, events, sent };
}

/** The steps the sent events give, through the driver's own reading of them. */
const stepsOf = (d: ReturnType<typeof domDouble>) =>
  stepsFromRecording({ startUrl: "http://expenses.proof.test/edit", events: recordedEventsFrom(d.events().map((m) => m.e)), pageShots: new Map() });

describe("the recorder in a DOM double (review of Phase 5 step 2)", () => {
  it("sends a field typed key by key once while it is the last event sent, through the binding: 300 keystrokes, then Submit", () => {
    const d = domDouble();
    const { f: amount, l } = d.field("input", { id: "amount", type: "text" }, "Amount");
    const submit = d.el("button", { id: "submit", type: "submit" }, "Submit expense");
    d.body.append(l, amount, submit);
    d.call("start", "tok");
    d.fire("pointerdown", amount);
    for (let i = 0; i < 300; i++) {
      d.fire("keydown", amount, { key: "a" });
      d.fire("input", amount);
    }
    d.fire("click", submit);
    // Typing again after something else was sent is sent again (and folded on the server by steps.ts keepRecorded).
    d.fire("pointerdown", amount);
    d.fire("input", amount);
    d.fire("input", amount);
    // Before: the binding leaves the queue empty, so every keystroke was an event of its own.
    expect(d.events().map((m) => m.e.type)).toEqual(["input", "click", "input"]);
  });

  it("names an opener by its label only, never the value it shows, but a menu button's own words", () => {
    const d = domDouble();
    // A prefilled edit form: a listbox button and a date picker button showing their saved values, no label.
    const reason = d.el("button", { id: "reason", "aria-haspopup": "listbox", "aria-controls": "reason-list" }, "Medical");
    const date = d.el("button", { id: "date", "aria-haspopup": "dialog" }, "12 March 2026");
    const more = d.el("button", { id: "more", "aria-haspopup": "menu" }, "More");
    const { f: kind, l: kindLabel } = d.field("button", { id: "kind", "aria-haspopup": "listbox" }, "Kind of leave");
    d.body.append(reason, date, more, kindLabel, kind);
    d.call("start", "tok");
    for (const b of [reason, date, more, kind]) d.fire("click", b);
    // Before: "Medical" and "12 March 2026", the values they hold.
    expect(d.events().map((m) => [m.e.control?.opener, m.e.control?.group])).toEqual([
      [true, null],
      [true, null],
      [true, "More"],
      [true, "Kind of leave"],
    ]);
  });

  it("never takes a listbox's label from its own button (a Headless UI listbox with no label), so no choice is named by the value", () => {
    const d = domDouble();
    const button = d.el("button", { id: "lb-btn", "aria-haspopup": "listbox", "aria-controls": "lb-opts", "aria-expanded": "true" }, "Medical");
    const family = d.el("li", { id: "o-fam", role: "option" }, "Family");
    const list = d.el("ul", { id: "lb-opts", role: "listbox", "aria-labelledby": "lb-btn" }).append(d.el("li", { id: "o-med", role: "option" }, "Medical"), family);
    d.body.append(button, list);
    d.call("start", "tok");
    d.fire("click", button);
    d.fire("click", family);
    const sent = d.events().map((m) => m.e.control);
    expect(sent.map((c) => c?.group)).toEqual([null, null]);
    expect(sent[1]).toMatchObject({ choice: true });
    // The steps: the opener folded into one choice named by no words. Before: "Choose in "Medical"".
    const steps = stepsOf(d);
    expect(steps.map((s) => s.kind)).toEqual(["start", "choose"]);
    expect(JSON.stringify(steps)).not.toMatch(/Medical|Family/);
  });

  it("still names a listbox's choices by a label it has, through its button's label", () => {
    const d = domDouble();
    const { f: button, l } = d.field("button", { id: "lb-btn", "aria-haspopup": "listbox", "aria-controls": "lb-opts" }, "Reason");
    const family = d.el("li", { id: "o-fam", role: "option" }, "Family");
    d.body.append(l, button, d.el("ul", { id: "lb-opts", role: "listbox", "aria-labelledby": "lb-btn" }).append(family));
    d.call("start", "tok");
    d.fire("click", family);
    expect(d.events()[0].e.control?.group).toBe("Reason");
  });

  it("never names a choice or a list by a label whose words echoed the typing: a legend, a list's heading, a caption, an aria-label", () => {
    const d = domDouble();
    const { f: who, l: whoLabel } = d.field("input", { id: "who", type: "text" }, "Who is it for?");
    const echo = d.el("span", { id: "who-echo" }, "someone");
    const legend = d.el("legend", {}, "Leave for").append(echo);
    const { f: half, l: halfLabel } = d.field("input", { id: "kind-half", type: "radio" }, "Half day");
    halfLabel.append(half);
    const fieldset = d.el("fieldset").append(legend, halfLabel);
    // A fieldset whose legend never changed still names its choice.
    const { f: paid, l: paidLabel } = d.field("input", { id: "paid", type: "radio" }, "Paid");
    paidLabel.append(paid);
    const steady = d.el("fieldset").append(d.el("legend", {}, "Leave type"), paidLabel);
    const headingWords = d.el("span", {}, "people");
    const heading = d.el("h3", { id: "pick-title" }, "Matching").append(headingWords);
    const person = d.el("li", { id: "p1", role: "option" }, "Pick");
    const people = d.el("ul", { role: "listbox", "aria-labelledby": "pick-title" }).append(person);
    const caption = d.el("caption", {}, "Results for nothing");
    const rowLink = d.el("a", { href: "/expense/101" }, "Open");
    const table = d.el("table").append(caption, d.el("tr").append(d.el("td").append(rowLink)));
    const loud = d.el("li", { id: "r1", role: "option" }, "One");
    const titled = d.el("div", { role: "radiogroup", "aria-label": "Choices" }).append(d.el("span").append(loud));
    d.body.append(whoLabel, who, fieldset, steady, heading, people, table, titled);
    d.call("start", "tok");
    d.fire("pointerdown", who);
    d.fire("input", who);
    // The page echoes the typing into each label, in place.
    echo.words = "Priya Shah";
    headingWords.words = "Priya Shah";
    caption.words = "Results for Priya Shah";
    titled.attrs["aria-label"] = "Choices for Priya Shah";
    d.mutate([
      { type: "childList", target: echo, addedNodes: [] },
      { type: "characterData", target: { nodeType: 3, parentElement: headingWords } },
      { type: "characterData", target: { nodeType: 3, parentElement: caption } },
      { type: "attributes", target: titled },
    ]);
    for (const c of [half, paid, person, rowLink, loud]) d.fire("click", c);
    const sent = d.events().slice(1).map((m) => m.e.control);
    // Before: "Leave for Priya Shah", "Matching Priya Shah", "Results for Priya Shah" and "Choices for Priya Shah".
    expect(sent.map((c) => [c?.group, c?.inRow])).toEqual([
      [null, null],
      ["Leave type", null],
      [null, ""],
      [null, ""],
      [null, ""],
    ]);
    expect(d.sent.join("")).not.toContain("Priya");
    expect(JSON.stringify(stepsOf(d))).not.toContain("Priya");
  });

  it("keeps only the role of a link or a button inside an editable region, whose words the person typed there", () => {
    const d = domDouble();
    const editor = d.el("div", { contenteditable: "true", "aria-label": "Message" });
    editor.isContentEditable = true;
    const link = d.el("a", { href: "http://expenses.proof.test/list" }, "Jane Doe's sick note");
    link.isContentEditable = true;
    const item = d.el("li");
    item.isContentEditable = true;
    const chip = d.el("button", { contenteditable: "false" }, "Sam Ortiz");
    item.append(chip);
    const list = d.el("ul", { "aria-label": "Typed list" });
    list.isContentEditable = true;
    list.append(item);
    editor.append(link, list);
    d.body.append(editor);
    d.call("start", "tok");
    d.fire("click", link);
    d.fire("click", chip);
    const sent = d.events().map((m) => m.e.control);
    // Before: named "Jane Doe's sick note" and "Sam Ortiz", in a list "Typed list".
    expect(sent.map((c) => [c?.name, c?.wordsChanged, c?.group, c?.inRow])).toEqual([
      ["", true, null, null],
      ["", true, null, ""],
    ]);
    expect(JSON.stringify(stepsOf(d))).not.toMatch(/Jane|Sam|Typed/);
  });

  it("records a click on a label with no labelable control: the control it names or holds, else the label itself", () => {
    const d = domDouble();
    const plain = d.el("label", {}, "Remember me");
    const toggle = d.el("div", { id: "toggle", role: "switch" }, "");
    const named = d.el("label", { for: "toggle" }, "Email me");
    const box = d.el("span", { role: "checkbox" }, "");
    const holding = d.el("label", {}, "Send copies").append(box);
    d.body.append(plain, named, toggle, holding);
    d.call("start", "tok");
    for (const l of [plain, named, holding]) d.fire("click", l);
    // Before: each dropped, with no gap.
    expect(d.events().map((m) => [m.e.type, m.e.control?.tag, m.e.control?.role])).toEqual([
      ["click", "label", "other"],
      ["click", "div", "switch"],
      ["click", "span", "checkbox"],
    ]);
    expect(d.events()[0].e.control?.name).toBe("Remember me");
  });

  it("caps every hint and label, so no page's attributes push an event past what the driver reads", () => {
    const d = domDouble();
    const { f: amount, l } = d.field("input", { id: "i".repeat(100_000), name: "n".repeat(100_000), autocomplete: "a".repeat(100_000), inputmode: "m".repeat(1000), type: "text" }, "Amount");
    const opt = d.el("li", { id: "o1", role: "option" }, "One");
    d.body.append(l, amount, d.el("ul", { role: "listbox", "aria-label": "x".repeat(100_000) }).append(opt));
    d.call("start", "tok");
    d.fire("pointerdown", amount);
    d.fire("input", amount);
    d.fire("click", opt);
    // Before: each attribute whole, a payload of 300 KB and more, which the driver drops.
    expect(Math.max(...d.sent.map((s) => s.length))).toBeLessThan(200_000);
    const [input, click] = d.events().map((m) => m.e.control as { hints: Record<string, string>; group: string });
    expect([input.hints.idAttr.length, input.hints.nameAttr.length, input.hints.autocomplete.length, input.hints.inputmode.length]).toEqual([300, 300, 200, 40]);
    expect(click.group.length).toBe(300);
  });
});

// ── Choices drawn without ARIA roles (final privacy review, M1) ─────

describe("the recorder keeps no option's words for a choice drawn without the choice roles (final privacy review, M1)", () => {
  /** A trusted press then click, as a person's pointer makes them. */
  const press = (d: ReturnType<typeof domDouble>, target: El, between?: () => void) => {
    d.fire("pointerdown", target);
    between?.();
    d.fire("click", target);
  };
  const words = (d: ReturnType<typeof domDouble>) => JSON.stringify(stepsOf(d));

  it("Ant Design's select: a role-less option with a pointer cursor, the only listbox a hidden sibling, and the trigger showing the saved value", () => {
    const d = domDouble();
    const input = d.el("input", { id: "dept-input", type: "search", role: "combobox", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": "dept_list", readonly: "" });
    const label = d.el("label", { for: "dept-input" }, "Department");
    label.control = input;
    input.labels = [label];
    const shown = d.el("span", { class: "ant-select-selection-item", title: "Engineering" }, "Engineering");
    const search = d.el("span", { class: "ant-select-selection-search" }).append(input);
    const selector = d.el("div", { class: "ant-select-selector" }).append(search, shown);
    const select = d.el("div", { class: "ant-select ant-select-single" }).append(selector);
    for (const b of [select, selector, search, shown]) b.cursor = "pointer";
    const a11y = d.el("div", { id: "dept_list", role: "listbox" }).append(d.el("div", { role: "option", "aria-selected": "true" }, "Engineering"));
    d.body.append(label, select, a11y);
    d.call("start", "tok");
    const content = d.el("div", { class: "ant-select-item-option-content" }, "Sales");
    const option = d.el("div", { class: "ant-select-item ant-select-item-option", "aria-selected": "false", title: "Sales" }).append(content);
    option.cursor = content.cursor = "pointer";
    const dropdown = d.el("div", { class: "ant-select-dropdown" }).append(d.el("div", { class: "rc-virtual-list" }).append(option));
    // rc-select opens on the press: its dropdown put into the page.
    press(d, shown, () => {
      d.body.append(dropdown);
      d.mutate([{ type: "childList", target: d.body, addedNodes: [dropdown] }]);
    });
    press(d, content);
    const [trigger, picked] = d.events().map((m) => m.e.control);
    // Before: Click "Engineering" (the value the trigger shows), then Click "Sales".
    expect(trigger).toMatchObject({ opener: true, name: "", group: "Department" });
    expect(picked).toMatchObject({ choice: true });
    expect(stepsOf(d).map((s) => s.kind)).toEqual(["start", "choose"]);
    expect(words(d)).not.toMatch(/Engineering|Sales/);
  });

  it("a toggle group of pressed buttons (MUI ToggleButtonGroup, a segmented control): a choice named by its group", () => {
    const d = domDouble();
    const medical = d.el("button", { type: "button", "aria-pressed": "true", value: "medical" }, "Medical");
    const family = d.el("button", { type: "button", "aria-pressed": "false", value: "family" }, "Family");
    const seg = d.el("span", { role: "radio", "aria-checked": "false" }, "Half day");
    d.body.append(d.el("div", { role: "group", "aria-label": "Leave reason" }).append(medical, family), d.el("div").append(seg));
    d.call("start", "tok");
    press(d, family);
    const sent = d.events()[0].e.control;
    // Before: Click "Family".
    expect(sent).toMatchObject({ choice: true, group: "Leave reason" });
    expect(stepsOf(d).map((s) => s.title)).toEqual(["Start on expenses.proof.test/edit", 'Choose in "Leave reason"']);
    expect(words(d)).not.toMatch(/Family|Medical/);
  });

  it("a Bootstrap 5 dropdown used as a select on an edit form: the toggle, with no aria-haspopup, shows the saved value, and its menu is shown by a class", () => {
    const d = domDouble();
    const toggle = d.el("button", { type: "button", id: "reason-toggle", class: "btn dropdown-toggle", "data-bs-toggle": "dropdown", "aria-expanded": "false" }, "Medical");
    const family = d.el("button", { type: "button", class: "dropdown-item" }, "Family");
    const menu = d.el("div", { class: "dropdown-menu", role: "presentation", "aria-labelledby": "reason-toggle" }).append(d.el("button", { type: "button", class: "dropdown-item" }, "Medical"), family);
    d.body.append(d.el("div", { class: "dropdown" }).append(toggle, menu));
    d.call("start", "tok");
    press(d, toggle, () => {
      toggle.attrs.class = "btn dropdown-toggle show";
      menu.attrs.class = "dropdown-menu show";
      d.mutate([
        { type: "attributes", target: toggle, attributeName: "class", oldValue: "btn dropdown-toggle" },
        { type: "attributes", target: menu, attributeName: "class", oldValue: "dropdown-menu" },
      ]);
    });
    press(d, family);
    const [opener, picked] = d.events().map((m) => m.e.control);
    // Before: Click "Medical" (the old value), then Click "Family".
    expect(opener).toMatchObject({ opener: true, name: "", group: null });
    expect(picked).toMatchObject({ choice: true, group: null, inRow: null });
    expect(stepsOf(d).map((s) => s.kind)).toEqual(["start", "choose"]);
    expect(words(d)).not.toMatch(/Medical|Family/);
  });

  it("a pre-rendered filter list shown by a class or a style: its plain clickable items are choices", () => {
    for (const how of ["class", "style", "hidden"] as const) {
      const d = domDouble();
      const filter = d.el("button", { type: "button", id: "filter-toggle" }, "Filter by reason");
      const family = d.el("span", { class: "chip" }, "Family");
      family.cursor = "pointer";
      const list = d.el("div", how === "class" ? { class: "filter-list is-hidden" } : how === "style" ? { class: "filter-list", style: "display: none" } : { class: "filter-list", hidden: "" }).append(d.el("span", { class: "chip" }, "Medical"), family);
      d.body.append(filter, list);
      d.call("start", "tok");
      press(d, filter, () => {
        if (how === "class") list.attrs.class = "filter-list";
        else if (how === "style") list.attrs.style = "";
        else delete list.attrs.hidden;
        d.mutate([{ type: "attributes", target: list, attributeName: how, oldValue: how === "class" ? "filter-list is-hidden" : how === "style" ? "display: none" : "" }]);
      });
      press(d, family);
      // Before: Click "Family", the class, style and hidden never watched.
      expect(d.events()[1].e.control, how).toMatchObject({ choice: true });
      expect(stepsOf(d).map((s) => s.title), how).toEqual(["Start on expenses.proof.test/edit", 'Click "Filter by reason"', "Choose an option"]);
      expect(words(d), how).not.toContain("Family");
    }
  });

  it("a choice opened by a key, its item chosen by a key, keeps no words either", () => {
    const d = domDouble();
    const toggle = d.el("button", { type: "button", class: "dropdown-toggle", "aria-expanded": "false" }, "Medical");
    const family = d.el("button", { type: "button", class: "dropdown-item" }, "Family");
    const menu = d.el("div", { class: "dropdown-menu" }).append(family);
    d.body.append(toggle, menu);
    d.call("start", "tok");
    // Enter on the focused toggle: a trusted click with no press, then the menu shown.
    d.fire("click", toggle);
    menu.attrs.class = "dropdown-menu show";
    d.mutate([{ type: "attributes", target: menu, attributeName: "class", oldValue: "dropdown-menu" }]);
    d.fire("click", family);
    expect(d.events()[1].e.control).toMatchObject({ choice: true });
    expect(words(d)).not.toMatch(/Medical|Family/);
  });

  it("still keeps a plain button's words: one a class only enabled, one in a box the press was already in, one shown long after the press", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const d = domDouble();
      const agree = d.el("input", { type: "checkbox", id: "agree" });
      const save = d.el("button", { type: "button", class: "btn disabled" }, "Save changes");
      const tabA = d.el("button", { type: "button" }, "Overview");
      const tabB = d.el("button", { type: "button" }, "History");
      const tabs = d.el("div", { class: "tabs" }).append(tabA, tabB);
      const late = d.el("button", { type: "button" }, "Export");
      const later = d.el("div", { class: "panel is-hidden" }).append(late);
      d.body.append(agree, save, tabs, later);
      d.call("start", "tok");
      // A box ticked enables Save: a class that shows nothing.
      press(d, agree, () => {
        save.attrs.class = "btn";
        d.mutate([{ type: "attributes", target: save, attributeName: "class", oldValue: "btn disabled" }]);
      });
      press(d, save);
      // The tabs' own box changes under the press: it was drawn already.
      press(d, tabA, () => {
        tabs.attrs.class = "tabs open";
        d.mutate([{ type: "attributes", target: tabs, attributeName: "class", oldValue: "tabs" }]);
      });
      press(d, tabB);
      // A panel shown 4 seconds after the last press: past the window.
      press(d, tabA);
      vi.setSystemTime(Date.now() + 4_000);
      later.attrs.class = "panel";
      d.mutate([{ type: "attributes", target: later, attributeName: "class", oldValue: "panel is-hidden" }]);
      press(d, late);
      const named = d.events().filter((m) => m.e.control?.tag === "button").map((m) => [m.e.control?.name, m.e.control?.choice]);
      expect(named).toEqual([
        ["Save changes", false],
        ["Overview", false],
        ["History", false],
        ["Overview", false],
        ["Export", false],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a suggestion that came in after the press on its field a suggestion, named by that field, and a menu's own items by their words", () => {
    const d = domDouble();
    const { f: approver, l } = d.field("input", { id: "approver", type: "text" }, "Approver");
    const box = d.el("div", { id: "suggestions" });
    const more = d.el("button", { type: "button", "aria-haspopup": "menu" }, "More");
    const duplicate = d.el("button", { type: "button", role: "menuitem" }, "Duplicate");
    const menu = d.el("div", { role: "menu", hidden: "" }).append(duplicate);
    d.body.append(l, approver, box, more, menu);
    d.call("start", "tok");
    d.fire("pointerdown", approver);
    d.fire("input", approver);
    const jane = d.el("button", { type: "button", class: "sugg" }, "Jane Doe, Oncology");
    box.append(jane);
    d.mutate([{ type: "childList", target: box, addedNodes: [jane] }]);
    press(d, jane);
    press(d, more, () => {
      delete menu.attrs.hidden;
      d.mutate([{ type: "attributes", target: menu, attributeName: "hidden", oldValue: "" }]);
    });
    press(d, duplicate);
    expect(stepsOf(d).map((s) => s.title)).toEqual(["Start on expenses.proof.test/edit", 'Type in "Approver"', 'Choose a suggestion in "Approver"', 'Click "More"', 'Click "Duplicate"']);
    expect(words(d)).not.toMatch(/Jane|Oncology/);
  });

  it("names a menu button by its own words still, and no opener of a value as another control's label", () => {
    const d = domDouble();
    const more = d.el("button", { type: "button", id: "more", "aria-haspopup": "menu", "aria-expanded": "false" }, "More");
    const toggle = d.el("button", { type: "button", id: "kind-toggle", "aria-expanded": "false" }, "Half day");
    const pick = d.el("li", { role: "option" }, "Full day");
    const list = d.el("ul", { role: "listbox", "aria-labelledby": "kind-toggle" }).append(pick);
    d.body.append(more, toggle, list);
    d.call("start", "tok");
    press(d, more);
    d.fire("click", pick);
    const [menuButton, choice] = d.events().map((m) => m.e.control);
    expect(menuButton).toMatchObject({ opener: true, group: "More" });
    // Before: the list named by its toggle's shown words, "Half day".
    expect(choice).toMatchObject({ choice: true, group: null });
  });
});
