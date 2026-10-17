// A recording's steps and a review's edit (src/lib/skills/steps.ts,
// docs/plans/ai-teammates-phase5.md Decisions 7, 11, 17, 18 and 20): what a
// click, a typing or a choice becomes, what is never kept, the fold of a
// sign-in, a code, a payment and a frame, the start page, and what an edit
// may change.

import { beforeAll, describe, expect, it } from "vitest";
import type { FieldHints } from "@/lib/browser/classes";
import { SKILLS_COPY } from "@/lib/agents/teammate-copy";
import {
  editSkill,
  fixedValueProblem,
  holdsSensitive,
  keepRecorded,
  keptName,
  matchStep,
  normName,
  recordableAddress,
  shotKey,
  sitesNotAllowed,
  skillDataLines,
  skillSites,
  stepPage,
  stepsFromRecording,
  storedSteps,
  wordsFreeTitle,
} from "./steps";
import { SKILL_LIMITS, type RecordedControl, type RecordedEvent, type SkillStep } from "./types";

const BANNED = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]|--`);

function hints(o: Partial<FieldHints> = {}): FieldHints {
  return { tag: "button", type: null, autocomplete: null, inputmode: null, name: null, id: null, label: null, maxLength: null, ...o };
}

function control(o: Partial<RecordedControl> = {}): RecordedControl {
  return {
    tag: "button",
    role: "button",
    name: "",
    type: null,
    formHost: null,
    formKey: null,
    group: null,
    choice: false,
    opener: false,
    inRow: null,
    inNav: false,
    suggestion: false,
    wordsChanged: false,
    href: null,
    hints: hints(),
    formFields: [],
    ...o,
  };
}

/**
 * Words only the reader's label hint holds (page-reader.ts labelHint: every
 * word of a field's labels, seen or not), never the field's visible name, so
 * a test finds them if a step ever keeps the hint (review of step 1, high).
 */
const HINT_ONLY = "hintonly unseen words";

/** A text field with its label, in a form or not: its visible name the label, its hint the label and words nobody sees. */
function field(label: string, o: Partial<RecordedControl> & { kind?: Partial<FieldHints> } = {}): RecordedControl {
  const h = hints({ tag: "input", type: "text", label: `${label} ${HINT_ONLY}`, name: label.toLowerCase(), ...(o.kind ?? {}) });
  const rest: Partial<RecordedControl> & { kind?: unknown } = { ...o };
  delete rest.kind;
  return control({ tag: "input", role: "textbox", name: label, type: h.type, hints: h, ...rest });
}

const EMAIL = hints({ tag: "input", type: "email", label: "Email", name: "email", autocomplete: "username" });
const PASSWORD = hints({ tag: "input", type: "password", label: "Password", name: "password", autocomplete: "current-password" });
const CARD = hints({ tag: "input", type: "text", label: "Card number", name: "cardnumber", autocomplete: "cc-number" });

const ev = (type: RecordedEvent["type"], c: RecordedControl | null, page: string, at = 0): RecordedEvent => ({ type, control: c, at, page });
const click = (c: RecordedControl, page: string) => ev("click", c, page);
const input = (c: RecordedControl, page: string) => ev("input", c, page);

const NEW = "https://exp.test/new";
const LIST = "https://exp.test/list";

function steps(events: RecordedEvent[], startUrl = "https://exp.test/", pageShots: ReadonlyMap<string, string> = new Map()): SkillStep[] {
  const out = stepsFromRecording({ startUrl, events, pageShots });
  // No step, in any test, keeps a word of the reader's label hint.
  expect(JSON.stringify(out)).not.toContain("hintonly");
  return out;
}

/** Every string anywhere in a value, so a word left anywhere is found. */
function json(v: unknown): string {
  return JSON.stringify(v);
}

const kinds = (s: SkillStep[]) => s.map((x) => x.kind);

describe("stepsFromRecording: the fold (Decision 7)", () => {
  it("folds a sign-in form into one step the person does themselves, keeping no field of it", () => {
    const email = field("Email", { formKey: 0, kind: EMAIL, formFields: [EMAIL, PASSWORD] });
    const password = field("Password", { formKey: 0, kind: PASSWORD, formFields: [EMAIL, PASSWORD] });
    const signIn = control({ name: "Sign in", formKey: 0, formHost: "exp.test", formFields: [EMAIL, PASSWORD] });
    const out = steps([click(email, NEW), input(email, NEW), click(password, NEW), input(password, NEW), click(signIn, NEW)]);
    expect(kinds(out)).toEqual(["start", "yourself"]);
    expect(out[1]).toMatchObject({ kind: "yourself", reason: "sign_in", title: "Sign in yourself", site: "exp.test", page: "exp.test/new" });
    // Before the fold by structure: "Type in Email" was kept.
    expect(json(out)).not.toMatch(/Email|Password|Type in/);
  });

  it("folds the whole page when the sign-in has no form element, and the next page's act is its own step", () => {
    const email = field("Email", { kind: EMAIL, formFields: [EMAIL, PASSWORD] });
    const password = field("Password", { kind: PASSWORD, formFields: [EMAIL, PASSWORD] });
    const signIn = control({ name: "Sign in", formFields: [EMAIL, PASSWORD] });
    const reports = control({ tag: "a", role: "link", name: "Reports", inNav: true, href: "/reports" });
    const out = steps([input(email, "https://exp.test/login"), input(password, "https://exp.test/login"), click(signIn, "https://exp.test/login"), click(reports, NEW)]);
    expect(kinds(out)).toEqual(["start", "yourself", "link"]);
    expect(out[1]).toMatchObject({ reason: "sign_in" });
    expect(out[2]).toMatchObject({ kind: "link", name: "Reports", page: "exp.test/new" });
  });

  it("folds a checkout form with a card field never typed in, before or after the act", () => {
    const placeOrder = control({ name: "Place order", formKey: 1, formHost: "exp.test", formFields: [hints({ tag: "input", label: "Name" }), CARD] });
    const out = steps([click(placeOrder, "https://exp.test/checkout")]);
    expect(kinds(out)).toEqual(["start", "yourself"]);
    expect(out[1]).toMatchObject({ reason: "payment", title: "Pay yourself" });
    expect(json(out)).not.toMatch(/Place order|order/i);
  });

  it("folds every act after focus entered a frame from another site, paying when a click there buys, else the frame", () => {
    const pay = control({ name: "Pay $480" });
    const paid = steps([ev("frame_focus", null, "https://exp.test/bill"), click(pay, "https://exp.test/bill")]);
    expect(kinds(paid)).toEqual(["start", "yourself"]);
    expect(paid[1]).toMatchObject({ reason: "payment", title: "Pay yourself" });
    expect(json(paid)).not.toContain("480");
    const next = control({ name: "Next" });
    const framed = steps([ev("frame_focus", null, "https://exp.test/verify"), click(next, "https://exp.test/verify")]);
    expect(framed[1]).toMatchObject({ kind: "yourself", reason: "frame", title: "Do this part yourself" });
    expect(framed).toHaveLength(2);
    // The next page is not the frame's.
    const after = steps([ev("frame_focus", null, "https://exp.test/verify"), click(next, "https://exp.test/verify"), click(control({ name: "Save" }), "https://exp.test/done")]);
    expect(kinds(after)).toEqual(["start", "yourself", "click"]);
  });

  it("makes consecutive folds of one reason on one page one step", () => {
    const a = control({ name: "Next", formKey: 0, formFields: [PASSWORD] });
    const out = steps([click(a, "https://exp.test/login"), click(a, "https://exp.test/login"), click(a, "https://exp.test/login")]);
    expect(kinds(out)).toEqual(["start", "yourself"]);
  });
});

describe("stepsFromRecording: choices, suggestions and rows are named by their list (Decision 7)", () => {
  it("names a radio by its group, never the option chosen", () => {
    const out = steps([click(control({ tag: "input", role: "radio", type: "radio", name: "Medical", group: "Reason", choice: true, hints: hints({ tag: "input", type: "radio", label: "Medical" }) }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "choose", via: "click", name: "Reason", title: 'Choose in "Reason"', value: { ask: true } });
    expect(json(out)).not.toContain("Medical");
  });

  it("names a custom listbox option by its list, and folds the click that opened it", () => {
    const opener = control({ role: "combobox", name: "Choose one", group: "Department", opener: true });
    const option = control({ tag: "div", role: "option", name: "Engineering", group: "Department", choice: true });
    const out = steps([click(opener, NEW), click(option, NEW)]);
    expect(kinds(out)).toEqual(["start", "choose"]);
    expect(out[1]).toMatchObject({ via: "click", name: "Department" });
    expect(json(out)).not.toMatch(/Engineering|Choose one/);
  });

  it("names a suggestion by the field typed in before it, never its words", () => {
    const approver = field("Approver", { formKey: 0 });
    const suggestion = control({ tag: "li", role: "option", name: "Jane Doe, Oncology", suggestion: true });
    const out = steps([click(approver, NEW), input(approver, NEW), click(suggestion, NEW)]);
    expect(kinds(out)).toEqual(["start", "type", "choose"]);
    expect(out[2]).toMatchObject({ via: "suggestion", name: "Approver", title: 'Choose a suggestion in "Approver"' });
    expect(json(out)).not.toMatch(/Jane|Doe|Oncology/);
  });

  it("names a row's link by the list, never the row's words", () => {
    const row = control({ tag: "a", role: "link", name: "Jane Doe, sick leave, 3 days", inRow: "My expenses", href: "/expense/7" });
    const out = steps([click(row, LIST)]);
    expect(out[1]).toMatchObject({ kind: "choose", via: "item", name: "My expenses", title: 'Open an item of "My expenses"' });
    expect(json(out)).not.toMatch(/Jane|Doe|sick|leave|3 days/);
  });

  it("names a combobox showing its value by its label only", () => {
    const combo = control({ role: "combobox", name: "Travel", group: "Category", opener: true });
    const out = steps([click(combo, NEW)]);
    expect(out[1]).toMatchObject({ kind: "click", name: "Category" });
    expect(json(out)).not.toContain("Travel");
    // An input combobox is a field: its click is the typing's.
    const typed = steps([click(field("Category", { role: "combobox", opener: true, name: "Travel", group: "Category" }), NEW)]);
    expect(kinds(typed)).toEqual(["start"]);
  });

  it("names a native list's choice by its label, never the option", () => {
    // The reader names a select by its labels' visible words; its hint holds every option.
    const select = control({ tag: "select", role: "combobox", name: "Category", hints: hints({ tag: "select", label: "Category Travel Meals Office", name: "category" }) });
    const out = steps([click(select, NEW), ev("change", select, NEW), ev("change", select, NEW)]);
    expect(kinds(out)).toEqual(["start", "choose"]);
    expect(out[1]).toMatchObject({ via: "list", name: "Category" });
    expect(json(out)).not.toMatch(/Travel|Meals|Office/);
    // A list sent as an opener whose shown words are its value is named by its group.
    const opener = control({ tag: "select", role: "combobox", name: "Travel", group: "Category", opener: true, hints: hints({ tag: "select", label: "Category Travel", name: "category" }) });
    const opened = steps([ev("change", opener, NEW)]);
    expect(opened[1]).toMatchObject({ via: "list", name: "Category" });
    expect(json(opened)).not.toContain("Travel");
  });

  // Review of step 1 (high): a field and a list were named by the reader's
  // label hint, which holds every word of their labels, seen or not.
  it("names a list its label wraps by the label's visible words, never the hint holding every option", () => {
    const select = control({ tag: "select", role: "combobox", name: "Approver", formKey: 0, hints: hints({ tag: "select", label: "Approver Jane Doe Sam Ortiz", name: "approver" }) });
    const out = steps([click(select, NEW), ev("change", select, NEW)]);
    expect(kinds(out)).toEqual(["start", "choose"]);
    // Before: a step named "Approver Jane Doe Sam Ortiz", every option and other people's names.
    expect(out[1]).toMatchObject({ kind: "choose", via: "list", name: "Approver", title: 'Choose in "Approver"' });
    expect(json(out)).not.toMatch(/Jane|Doe|Sam|Ortiz/);
  });

  it("types in a textarea its label wraps as one step named by the label's visible words, whatever the hint holds as it is typed", () => {
    // React sets a textarea's text on every change: from the second key the label's textContent holds what was typed.
    const reason = (label: string) => control({ tag: "textarea", role: "textbox", name: "Reason", formKey: 0, hints: hints({ tag: "textarea", label, name: "reason" }) });
    const typed = ["Reason", "Reason I", "Reason I have surg", "Reason I have surgery on Monday"];
    const out = steps([click(reason("Reason"), NEW), ...typed.map((label) => input(reason(label), NEW)), click(control({ name: "Send for approval", formKey: 0, formHost: "exp.test" }), NEW)]);
    // Before: a "type" step for each keystroke, named "Reason I", "Reason I have surg" and on.
    expect(kinds(out)).toEqual(["start", "type", "click"]);
    expect(out[1]).toMatchObject({ kind: "type", name: "Reason", fieldKind: "textarea", title: 'Type in "Reason"' });
    expect(json(out)).not.toMatch(/ I\b|have|surg|Monday/);
  });
});

describe("stepsFromRecording: names (Decision 7)", () => {
  it("keeps only the role of a name with an email or 4 digits, and names a control that acts by its action word", () => {
    const out = steps([click(control({ name: "Invite jane@acme.com" }), NEW), click(control({ name: "Order 48213" }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "click", role: "button", name: "", title: "Click the button" });
    expect(out[1].kind === "click" && out[1].warnings).toContain("sends");
    expect(out[2]).toMatchObject({ kind: "click", name: "order", title: 'Click "order"' });
    expect(json(out)).not.toMatch(/jane|acme|48213/);
  });

  it("makes a link that acts a click step with the role link, and a plain link a link step", () => {
    const approve = control({ tag: "a", role: "link", name: "Approve", href: "/invoices/7/approve" });
    const mine = control({ tag: "a", role: "link", name: "My expenses", href: "/list" });
    const out = steps([click(approve, LIST), click(mine, NEW)]);
    expect(out[1]).toMatchObject({ kind: "click", role: "link", name: "approve" });
    expect(out[2]).toMatchObject({ kind: "link", name: "My expenses", title: 'Go to "My expenses"' });
    // Never the address.
    expect(json(out)).not.toMatch(/invoices|href/);
  });

  it("keeps a plain button's words, made plain, and a tab's", () => {
    const out = steps([click(control({ name: "  Add\n line  " }), NEW), click(control({ role: "tab", name: "Overview", inNav: true }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "click", name: "Add line", title: 'Click "Add line"' });
    expect(out[2]).toMatchObject({ kind: "click", role: "tab", name: "Overview" });
  });
});

describe("stepsFromRecording: the order of the rules (spec review 2, finding 3)", () => {
  it("makes Delete in a menu a click step named by its action word with its warning, never a choice", () => {
    const out = steps([click(control({ tag: "div", role: "menuitem", name: "Delete" }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "click", role: "menuitem", name: "delete" });
    expect(out[1].kind === "click" && out[1].warnings).toContain("deletes");
  });

  it("keeps a nav link's words, never 'an item'", () => {
    const out = steps([click(control({ tag: "a", role: "link", name: "Reports", inNav: true, inRow: null, href: "/reports" }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "link", name: "Reports" });
  });

  it("makes an acting control in a data row a click step named by its action word, with none of the row's words", () => {
    const out = steps([click(control({ name: "Approve Jane Doe's leave", inRow: "Leave requests" }), LIST)]);
    expect(out[1]).toMatchObject({ kind: "click", name: "approve" });
    expect(json(out)).not.toMatch(/Jane|Doe|leave/i);
  });

  it("makes a link acting by its query a click step, by its role only (an address is never kept)", () => {
    const out = steps([click(control({ tag: "a", role: "link", name: "Open", href: "/wf.do?method=approve&id=5", inRow: "My expenses" }), LIST)]);
    expect(out[1]).toMatchObject({ kind: "click", role: "link", name: "", title: "Click the link" });
    expect(json(out)).not.toMatch(/wf\.do|method|id=5/);
  });

  it("makes a row link acting by a camelCase path a click step, never an item (review of step 1)", () => {
    const out = steps([click(control({ tag: "a", role: "link", name: "Jane Doe, 3 days", href: "/leave/approveLeave?id=5", inRow: "Leave requests" }), LIST)]);
    // Before: a "choose" (item) step that a run would follow with open_page, with no card.
    expect(out[1]).toMatchObject({ kind: "click", role: "link", name: "" });
    expect(json(out)).not.toMatch(/Jane|approveLeave/);
  });

  it("keeps a menuitemradio a choice, and a plain menu item's words", () => {
    const out = steps([click(control({ role: "menuitemradio", name: "Weekly", group: "Repeat", choice: true }), NEW), click(control({ role: "menuitem", name: "Duplicate" }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "choose", via: "click", name: "Repeat" });
    expect(out[2]).toMatchObject({ kind: "click", role: "menuitem", name: "Duplicate" });
    expect(json(out)).not.toContain("Weekly");
  });

  it("keeps an opener no choice follows by its label, before the menu item after it", () => {
    const more = control({ name: "More", group: "More", opener: true });
    const out = steps([click(more, NEW), click(control({ role: "menuitem", name: "Delete draft" }), NEW)]);
    expect(out.slice(1).map((s) => [s.kind, "name" in s ? s.name : null])).toEqual([
      ["click", "More"],
      ["click", "delete"],
    ]);
    expect(json(out)).not.toContain("draft");
  });
});

describe("stepsFromRecording: suggestions and echoes (spec review 2, finding 7)", () => {
  it("names a plain suggestion under a field with no form element by that field, never its words", () => {
    const find = field("Find a colleague");
    const out = steps([input(find, NEW), click(control({ tag: "div", role: "button", name: "Sam Ortiz, Payroll", suggestion: true }), NEW)]);
    expect(out[2]).toMatchObject({ kind: "choose", via: "suggestion", name: "Find a colleague" });
    expect(json(out)).not.toMatch(/Sam|Ortiz|Payroll/);
  });

  it("keeps only the role of a button whose words echo the typing, and never an action word from it", () => {
    const out = steps([click(control({ name: "Search for 'medical leave'", wordsChanged: true }), NEW), click(control({ name: "Search for 'delete my data'", wordsChanged: true }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "click", name: "", title: "Click the button" });
    // Its words echo the typing: no action word, class or warning comes from them.
    expect(out[2]).toMatchObject({ kind: "click", name: "", warnings: [] });
    expect(json(out)).not.toMatch(/medical|leave|delete|data/);
  });
});

// Review of step 1: rule 2 ran before the suggestion rule, so a suggestion
// drawn as a nav link or a menu item kept its words, and a suggestion's
// words fed rule 1's action word and the click warnings.
describe("stepsFromRecording: a suggestion keeps no words, wherever it sits (review of step 1)", () => {
  it("names a search box's live result drawn as a nav link by the field typed in, never its words", () => {
    const search = field("Search people", { inNav: true });
    const result = control({ tag: "a", role: "link", name: "Jane Doe, Oncology", inNav: true, suggestion: true, href: "https://exp.test/people/jane-doe" });
    const out = steps([click(search, NEW), input(search, NEW), click(result, NEW)]);
    expect(kinds(out)).toEqual(["start", "type", "choose"]);
    // Before: a "link" step named "Jane Doe, Oncology".
    expect(out[2]).toMatchObject({ kind: "choose", via: "suggestion", name: "Search people", title: 'Choose a suggestion in "Search people"' });
    expect(json(out)).not.toMatch(/Jane|Doe|Oncology|people\/jane/);
  });

  it("names an autocomplete drawn as menu items by the field, never the item's echo of the typing", () => {
    const find = field("Find");
    const item = control({ tag: "div", role: "menuitem", name: "Search for 'medical leave'", suggestion: true });
    const out = steps([input(find, NEW), click(item, NEW)]);
    // Before: a "click" step named "Search for 'medical leave'", the typed words.
    expect(out[2]).toMatchObject({ kind: "choose", via: "suggestion", name: "Find" });
    expect(json(out)).not.toMatch(/medical|leave|Search for/);
  });

  it("reads no action word and no warning from a suggestion's words", () => {
    const help = field("Help");
    const echo = control({ tag: "div", role: "button", name: "Search for 'cancel my order'", suggestion: true });
    const out = steps([input(help, NEW), click(echo, NEW)]);
    // Before: a "click" step named "cancel", with the deletes and buys warnings, from words the person typed.
    expect(out[2]).toMatchObject({ kind: "choose", via: "suggestion", name: "Help" });
    expect(json(out)).not.toMatch(/cancel|order|deletes|buys/);
    // A suggestion whose address acts is still a click step, by its role only.
    const acting = steps([input(help, NEW), click(control({ tag: "a", role: "link", name: "Approve all for 'jane'", suggestion: true, href: "/approve?who=jane" }), NEW)]);
    expect(acting[2]).toMatchObject({ kind: "click", role: "link", name: "" });
    expect(json(acting)).not.toMatch(/jane|Approve all/);
  });

  it("names no suggestion by a field whose own words echoed the typing, nor by the suggestion's group", () => {
    const to = field("To: Jane Doe", { wordsChanged: true });
    const out = steps([input(to, NEW), click(control({ tag: "li", role: "button", name: "Jane Doe", suggestion: true }), NEW)]);
    expect(out[1]).toMatchObject({ kind: "type", name: "" });
    // Before: the suggestion was named by the echoed label.
    expect(out[2]).toMatchObject({ kind: "choose", via: "suggestion", name: "", title: "Choose a suggestion" });
    expect(json(out)).not.toMatch(/Jane|Doe/);
    // With no typing seen on the page, a suggestion's group, which came in with it, names nothing either.
    const ungrouped = steps([click(control({ tag: "div", role: "button", name: "Jane Doe", group: "People named Jane", suggestion: true }), NEW)]);
    expect(ungrouped[1]).toMatchObject({ kind: "choose", via: "suggestion", name: "" });
    expect(json(ungrouped)).not.toMatch(/Jane|Doe/);
  });
});

describe("stepsFromRecording: typing", () => {
  it("makes typing in one field one step by its label, with Enter, and never a character typed", () => {
    const amount = field("Amount", { formKey: 0 });
    const notes = field("Notes", { tag: "textarea", formKey: 0, kind: { tag: "textarea", type: null } });
    const out = steps([click(amount, NEW), input(amount, NEW), input(amount, NEW), ev("enter", amount, NEW), click(notes, NEW), input(notes, NEW), input(amount, NEW)]);
    expect(kinds(out)).toEqual(["start", "type", "type", "type"]);
    expect(out[1]).toMatchObject({ name: "Amount", fieldKind: "text", pressEnter: true, title: 'Type in "Amount"', value: { ask: true } });
    expect(out[2]).toMatchObject({ name: "Notes", fieldKind: "textarea", pressEnter: false });
    expect(out[3]).toMatchObject({ name: "Amount" });
  });

  it("drops a click on a field and never types on a checkbox's input", () => {
    const box = control({ tag: "input", role: "checkbox", type: "checkbox", name: "Billable", hints: hints({ tag: "input", type: "checkbox", label: "Billable" }) });
    const out = steps([click(field("Amount"), NEW), click(box, NEW), input(box, NEW), ev("change", box, NEW)]);
    expect(kinds(out)).toEqual(["start", "click"]);
    expect(out[1]).toMatchObject({ role: "checkbox", name: "Billable" });
  });
});

describe("stepsFromRecording: gaps, values, sites and the cap", () => {
  it("makes a gap event a gap step, which the data lines give as nothing to do", () => {
    const out = steps([ev("gap", null, NEW)]);
    expect(out[1]).toMatchObject({ kind: "gap", title: "Something may be missing here" });
    expect(skillDataLines(out, "Max")[1]).toBe("2. A step here may be missing from the recording: follow the page, and ask Max if you are not sure");
  });

  it("asks every value each time, keeps no text the events did not name, and the start at its recordable address", () => {
    const amount = field("Amount");
    const start = "https://exp.test/new?draft=1#top";
    const out = steps([input(amount, NEW), click(control({ name: "Submit expense", formKey: 0 }), NEW)], start, new Map([[shotKey(start), "shot_0"], [shotKey(NEW), "shot_1"]]));
    expect(out[0]).toMatchObject({ kind: "start", address: "https://exp.test/new", title: "Start on exp.test/new", site: "exp.test", shotId: "shot_0" });
    // A picture is kept by its page's address without its fragment.
    expect(shotKey(start)).toBe("https://exp.test/new?draft=1");
    for (const s of out) {
      if ("value" in s) expect(s.value).toEqual({ ask: true });
      // No key named value holds a string.
      expect(json(s)).not.toMatch(/"value":"/);
    }
    expect(out[2]).toMatchObject({ kind: "click", name: "submit", shotId: "shot_1" });
    expect(json(out)).not.toMatch(/draft|top|expense/);
    expect(out.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("keeps at most 100 steps of 101 events", () => {
    const events = Array.from({ length: 101 }, (_, i) => click(control({ name: `Save ${String.fromCharCode(65 + (i % 26))}` }), NEW));
    const out = steps(events);
    expect(out).toHaveLength(SKILL_LIMITS.recordedStepsMax);
    expect(out[99].id).toBe("s100");
  });

  it("records nothing off a web page", () => {
    expect(steps([click(control({ name: "Save" }), "about:blank")])).toHaveLength(1);
    expect(steps([], "about:blank")).toEqual([]);
  });
});

describe("keepRecorded: the events a recording keeps (review of Phase 5 step 2, M1)", () => {
  it("folds a field's repeated typing on one page, and keeps the same steps as every event would", () => {
    const amount = field("Amount");
    const notes = field("Notes");
    const all = [input(amount, NEW), input(amount, NEW), ev("enter", amount, NEW), input(amount, NEW), input(notes, NEW), input(notes, NEW), input(amount, NEW), click(amount, NEW), input(amount, NEW), input(amount, LIST)];
    const kept: RecordedEvent[] = [];
    expect(keepRecorded(kept, all, 400)).toEqual({ added: 7, full: false });
    // An Enter and the typing after it, another field, a click on it, and another page each break the fold.
    expect(kept.map((e) => `${e.type}:${e.control?.name}:${e.page === LIST ? "list" : "new"}`)).toEqual(["input:Amount:new", "enter:Amount:new", "input:Notes:new", "input:Amount:new", "click:Amount:new", "input:Amount:new", "input:Amount:list"]);
    expect(steps(kept)).toEqual(steps(all));
  });

  it("folds across calls, so a poll's drain continues the typing the last one ended on", () => {
    const amount = field("Amount");
    const kept: RecordedEvent[] = [];
    keepRecorded(kept, Array.from({ length: 300 }, () => input(amount, NEW)), 400);
    expect(keepRecorded(kept, [...Array.from({ length: 300 }, () => input(amount, NEW)), click(control({ name: "Submit expense" }), NEW)], 400)).toEqual({ added: 1, full: false });
    expect(kept.map((e) => e.type)).toEqual(["input", "click"]);
  });

  it("keeps at most max, then one gap where the first event was dropped, and nothing after", () => {
    const a = control({ name: "A" });
    const b = control({ name: "B" });
    const kept: RecordedEvent[] = [];
    const many = Array.from({ length: 5 }, (_, i) => click(i % 2 ? a : b, NEW));
    expect(keepRecorded(kept, many, 3)).toEqual({ added: 4, full: true });
    expect(kept.map((e) => e.type)).toEqual(["click", "click", "click", "gap"]);
    expect(kept[3]).toMatchObject({ type: "gap", control: null, page: NEW });
    expect(keepRecorded(kept, [click(a, LIST)], 3)).toEqual({ added: 0, full: true });
    expect(kinds(steps(kept))).toEqual(["start", "click", "click", "click", "gap"]);
  });
});

describe("recordableAddress and stepPage (Decision 7)", () => {
  it("keeps origin and path only, and the site's home for an id, a token, a code or an action", () => {
    expect(recordableAddress("https://a.test/new?tab=2#x")).toBe("https://a.test/new");
    expect(recordableAddress("https://a.test/reset/9fK2mQ7xL4pR8sT1vW3y")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/s;jsessionid=AB12")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/orders/48213/approve")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/verify/code-482913")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/u/jane@acme.com")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/expenses/submit")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/pay")).toBe("https://a.test/");
    // An action in the query alone still makes the start the home (Decision 17 never meets Decision 18).
    expect(recordableAddress("https://a.test/list?do=delete")).toBe("https://a.test/");
    expect(recordableAddress("https://a.test/expenses/weekly")).toBe("https://a.test/expenses/weekly");
    expect(recordableAddress("https://user:pw@a.test:8443/x")).toBe("https://a.test:8443/x");
    // Never empty for a web page; "" for none.
    expect(recordableAddress("https://a.test")).toBe("https://a.test/");
    expect(recordableAddress("about:blank")).toBe("");
    expect(recordableAddress("javascript:alert(1)")).toBe("");
  });

  // Review of step 1: "-" and "_" broke a token's run, so base64url tokens and
  // UUIDs with no run of 4 digits passed as plain path parts.
  it("gives the site's home for a token or id holding '-' or '_', a UUID's shape or a run of hex", () => {
    for (const u of [
      "https://a.test/reset/9fK2mQ7x-L4pR8sT1vW3y",
      "https://a.test/s/Ab_3kL9mQ2xR7pTz",
      // A v4 UUID with no run of 4 digits, its groups at most 12 characters.
      "https://a.test/invite/a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      "https://a.test/files/9f8e7d6c5b4a",
      "https://a.test/magic/A1b2C3d4E5f6G7h8",
    ]) {
      expect(recordableAddress(u), u).toBe("https://a.test/");
    }
    expect(stepPage("https://a.test/a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5/edit")).toBe("a.test/*");
    expect(stepPage("https://a.test/invite/a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5")).toBe("a.test/invite");
    // Harmless slugs stay.
    expect(recordableAddress("https://a.test/expenses/weekly-report")).toBe("https://a.test/expenses/weekly-report");
    expect(recordableAddress("https://a.test/team-offsite-planning_board")).toBe("https://a.test/team-offsite-planning_board");
  });

  // Review of step 1: camelCase actions and Phase 4's own verbs were kept as a start.
  it("gives the site's home for a start whose path acts in camelCase or by Phase 4's verbs", () => {
    for (const u of ["https://hr.test/Leave/ApproveLeave/5", "https://hr.test/timesheets/approveAll", "https://hr.test/approveRequest.do", "https://a.test/members/5/deactivate", "https://a.test/sessions/revoke", "https://a.test/cart/add"]) {
      expect(recordableAddress(u), u).toBe(`${new URL(u).origin}/`);
    }
    expect(recordableAddress("https://hr.test/leave/requests")).toBe("https://hr.test/leave/requests");
  });

  it("gives a step's host and first path part, an id-like part as *", () => {
    expect(stepPage("https://a.test/employees/48213/leave")).toBe("a.test/employees");
    expect(stepPage("https://a.test/u/jane@acme.com")).toBe("a.test/u");
    expect(stepPage("https://a.test/48213/leave")).toBe("a.test/*");
    expect(stepPage("https://a.test/jane@acme.com")).toBe("a.test/*");
    expect(stepPage("https://A.Test./")).toBe("a.test");
    expect(stepPage("https://a.test/my%20expenses?x=1")).toBe("a.test/my expenses");
  });
});

describe("keptName", () => {
  it("keeps plain words and drops an email, a phone number, 4 digits in a row or anything hidden", () => {
    expect(keptName(" Save  draft ")).toBe("Save draft");
    for (const n of ["Invite jane@acme.com", "Call +1 (555) 123-456", "Room 2026", "Card 4242 4242 4242 4242", "Your code is 482913"]) expect(keptName(n), n).toBe("");
    expect(keptName("Call 555 12")).toBe("Call 555 12");
    expect(keptName("x".repeat(300))).toHaveLength(120);
  });
});

describe("editSkill (Decision 11)", () => {
  const stored = (): SkillStep[] =>
    steps([
      input(field("Amount"), NEW),
      ev("change", control({ tag: "select", role: "combobox", name: "Category", hints: hints({ tag: "select", label: "Category Travel Meals" }) }), NEW),
      click(control({ name: "Add line" }), NEW),
      click(control({ tag: "a", role: "link", name: "My expenses", href: "/list" }), NEW),
    ]);
  const keepAll = (s: SkillStep[]) => s.map((x) => ({ id: x.id }));

  it("refuses an id not stored, one moved, and one twice", () => {
    const s = stored();
    expect(editSkill(s, [...keepAll(s), { id: "s99" }])).toEqual({ ok: false, problem: "unknown_step", stepId: "s99" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s3" }, { id: "s2" }])).toEqual({ ok: false, problem: "order", stepId: "s2" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s2" }, { id: "s2" }])).toEqual({ ok: false, problem: "order", stepId: "s2" });
  });

  it("refuses a value on a click and a fixed value the redaction would hide", () => {
    const s = stored();
    expect(editSkill(s, [{ id: "s1" }, { id: "s4", value: { fixed: "x" } }])).toMatchObject({ ok: false, problem: "value", stepId: "s4" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s2", value: { fixed: "4242 4242 4242 4242" } }])).toEqual({ ok: false, problem: "value", stepId: "s2", valueProblem: "sensitive" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s2", value: { fixed: "Your code is 482913" } }])).toEqual({ ok: false, problem: "value", stepId: "s2", valueProblem: "sensitive" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s2", value: { fixed: "x\ny" } }])).toMatchObject({ valueProblem: "control" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s3", value: { fixed: "x".repeat(81) } }])).toMatchObject({ valueProblem: "too_long" });
    expect(editSkill(s, [{ id: "s1" }, { id: "s2", value: { bogus: 1 } as never }])).toMatchObject({ problem: "value" });
    // A fixed value the person typed is kept, trimmed; asked each time is the default.
    const ok = editSkill(s, [{ id: "s1" }, { id: "s2", value: { fixed: " 42.50 " } }, { id: "s3", value: { fixed: "Travel" } }]);
    expect(ok.ok && ok.steps.map((x) => ("value" in x ? x.value : null))).toEqual([null, { fixed: "42.50" }, { fixed: "Travel" }]);
  });

  it("refuses more than 50 steps, none, and a start step left out", () => {
    const many: SkillStep[] = steps(Array.from({ length: 60 }, (_, i) => click(control({ name: `Save ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}` }), NEW)));
    expect(editSkill(many, many.slice(0, 51).map((x) => ({ id: x.id })))).toEqual({ ok: false, problem: "too_many" });
    expect(editSkill(many, many.slice(0, 50).map((x) => ({ id: x.id })))).toMatchObject({ ok: true });
    expect(editSkill(many, [])).toMatchObject({ ok: false, problem: "start" });
    expect(editSkill(many.slice(1), [])).toEqual({ ok: false, problem: "empty" });
    expect(editSkill(many, [{ id: "s2" }])).toEqual({ ok: false, problem: "start", stepId: "s1" });
  });

  it("forgets a step's words: no stored name, the title back to its words-free default, and a title holding them refused", () => {
    const s = stored();
    const r = editSkill(s, [{ id: "s1" }, { id: "s4", forgetName: true }, { id: "s5", forgetName: true }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps[1]).toMatchObject({ kind: "click", name: "", title: "Click the button" });
    expect(r.steps[2]).toMatchObject({ kind: "link", name: "", title: "Go to a link" });
    expect(json(r.steps)).not.toMatch(/Add line|My expenses/);
    expect(editSkill(s, [{ id: "s1" }, { id: "s4", forgetName: true, title: "Click add LINE now" }])).toEqual({ ok: false, problem: "title", stepId: "s4", titleProblem: "removed" });
    const titled = editSkill(s, [{ id: "s1" }, { id: "s4", forgetName: true, title: "Add a row" }]);
    expect(titled.ok && titled.steps[1]).toMatchObject({ name: "", title: "Add a row" });
  });

  it("shortens the start to the site's home, and takes no site, name or address from what it is sent", () => {
    const s = steps([click(control({ name: "Save" }), "https://exp.test/new")], "https://exp.test/expenses/weekly");
    const r = editSkill(s, [{ id: "s1", site: "evil.test", address: "https://evil.test/", name: "x" } as never, { id: "s2", site: "evil.test", name: "Pay", role: "link", title: " Save it " } as never], { startHome: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Its page and recorded title follow the home address (review of step 3; before: "exp.test/expenses" and "Start on exp.test/expenses").
    expect(r.steps[0]).toMatchObject({ kind: "start", address: "https://exp.test/", site: "exp.test", page: "exp.test", title: "Start on exp.test" });
    expect(r.steps[1]).toMatchObject({ kind: "click", name: "Save", role: "button", site: "exp.test", title: "Save it" });
    expect(json(r.steps)).not.toContain("evil");
    // Each title refusal says its own reason (review of step 3).
    expect(editSkill(s, [{ id: "s1", title: "   " }])).toEqual({ ok: false, problem: "title", stepId: "s1", titleProblem: "empty" });
    expect(editSkill(s, [{ id: "s1", title: "x".repeat(121) }])).toEqual({ ok: false, problem: "title", stepId: "s1", titleProblem: "too_long" });
    // The stored list is not changed by an edit.
    expect(s[0]).toMatchObject({ address: "https://exp.test/expenses/weekly", page: "exp.test/expenses", title: "Start on exp.test/expenses" });
  });

  it("keeps the person's own name for the start step when it goes to the site's home, sent now or saved before (review of step 3)", () => {
    const s = steps([click(control({ name: "Save" }), "https://exp.test/new")], "https://exp.test/expenses/weekly");
    const sent = editSkill(s, [{ id: "s1", title: "Open my expenses" }, { id: "s2" }], { startHome: true });
    expect(sent.ok && sent.steps[0]).toMatchObject({ address: "https://exp.test/", page: "exp.test", title: "Open my expenses" });
    const before = structuredClone(s);
    before[0] = { ...before[0], title: "Where I begin" };
    const saved = editSkill(before, [{ id: "s1" }, { id: "s2" }], { startHome: true });
    expect(saved.ok && saved.steps[0]).toMatchObject({ address: "https://exp.test/", page: "exp.test", title: "Where I begin" });
  });
});

describe("fixedValueProblem", () => {
  it("names each reason", () => {
    expect(fixedValueProblem("Sales", "choose")).toBeNull();
    expect(fixedValueProblem("4242-4242-4242-4242", "type")).toBe("sensitive");
    expect(fixedValueProblem("DE89 3704 0044 0532 0130 00", "type")).toBe("sensitive");
    expect(fixedValueProblem("tab\there", "type")).toBe("control");
    expect(fixedValueProblem(`a${String.fromCharCode(0x202e)}b`, "type")).toBe("control");
    expect(fixedValueProblem("   ", "type")).toBe("empty");
    expect(fixedValueProblem("x".repeat(2001), "type")).toBe("too_long");
    expect(fixedValueProblem("x".repeat(2000), "type")).toBeNull();
    expect(fixedValueProblem("x".repeat(81), "choose")).toBe("too_long");
  });

  it("finds a card number split by dots or slashes, written in full-width or another script's digits, a code in full-width, and an IBAN in lower case (review of step 3)", () => {
    const fw = (t: string) => [...t].map((c) => (/[0-9a-z]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join("");
    const arabic = (t: string) => t.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    // Before: each of these was kept as a fixed value.
    for (const v of [
      "4242.4242.4242.4242",
      "4242/4242/4242/4242",
      "4242 . 4242 / 4242_4242",
      fw("4242 4242 4242 4242"),
      fw("4242424242424242"),
      arabic("4242 4242 4242 4242"),
      fw("code 482913"),
      "de89 3704 0044 0532 0130 00",
      "gb29nwbk60161331926819",
      "De89-3704-0044-0532-0130-00",
    ]) {
      expect(fixedValueProblem(v, "type"), v).toBe("sensitive");
      expect(holdsSensitive(v), v).toBe(true);
    }
    // Words, dates, amounts and short numbers are kept.
    for (const v of ["ab12 project kickoff notes", "2026/10/17", "42.50", "Room 12.3", "Q3 report for de12 team", "Sales"]) {
      expect(fixedValueProblem(v, "type"), v).toBeNull();
      expect(holdsSensitive(v), v).toBe(false);
    }
  });
});

describe("skillSites, sitesNotAllowed and normName", () => {
  it("lists each host once in the order met, and those not allowed now", () => {
    const s = steps([click(control({ name: "Save" }), "https://b.test/x"), click(control({ name: "Save" }), "https://exp.test/y"), click(control({ name: "Go" }), "https://c.test/z")]);
    expect(skillSites(s)).toEqual(["exp.test", "b.test", "c.test"]);
    expect(sitesNotAllowed(s, (h) => h === "exp.test")).toEqual(["b.test", "c.test"]);
    expect(normName(`  Submit${String.fromCharCode(0xa0)} EXPENSE `)).toBe("submit expense");
  });

  it("lists at most 20 hosts", () => {
    const s = steps(Array.from({ length: 25 }, (_, i) => click(control({ name: "Save" }), `https://h${String.fromCharCode(97 + i)}.test/`)));
    expect(skillSites(s)).toHaveLength(SKILL_LIMITS.sitesMax);
  });
});

describe("matchStep (Decision 20)", () => {
  // Built before the tests, not while they are collected, so a step that kept a hint fails these tests only.
  let s: SkillStep[] = [];
  beforeAll(() => {
    s = steps(
      [
        input(field("Amount"), NEW),
        click(control({ name: "Submit expense", formKey: 0 }), NEW),
        click(control({ tag: "input", role: "radio", name: "Medical", group: "Reason", choice: true }), NEW),
        click(control({ name: "Save" }), "https://other.test/x"),
        click(control({ name: "Save" }), NEW),
      ],
      "https://exp.test/new",
    );
  });

  it("matches by kind, host and name, never across hosts and never backwards", () => {
    expect(matchStep(s, -1, { kind: "type", site: "exp.test", name: " amount " })).toBe(1);
    expect(matchStep(s, 1, { kind: "type", site: "exp.test", name: "Amount" })).toBeNull();
    expect(matchStep(s, -1, { kind: "type", site: "exp.test", name: "Notes" })).toBeNull();
    // Named by its action word: the control's words hold it whole.
    expect(matchStep(s, -1, { kind: "click", site: "exp.test", role: "button", name: "Submit expense", choiceRole: false })).toBe(2);
    expect(matchStep(s, -1, { kind: "click", site: "exp.test", role: "button", name: "Submitted", choiceRole: false })).toBeNull();
    expect(matchStep(s, -1, { kind: "click", site: "exp.test", role: "link", name: "Submit", choiceRole: false })).toBeNull();
    // Save on exp.test is step 6, never other.test's step 5.
    expect(matchStep(s, -1, { kind: "click", site: "exp.test", role: "button", name: "Save", choiceRole: false })).toBe(5);
    expect(matchStep(s, -1, { kind: "click", site: "other.test", role: "button", name: "Save", choiceRole: false })).toBe(4);
    expect(matchStep(s, 5, { kind: "click", site: "exp.test", role: "button", name: "Save", choiceRole: false })).toBeNull();
  });

  it("matches a click on a radio to a choice made by clicking", () => {
    expect(matchStep(s, -1, { kind: "click", site: "exp.test", role: "radio", name: "Personal", choiceRole: true })).toBe(3);
    expect(matchStep(s, -1, { kind: "choose", site: "exp.test", name: "Reason" })).toBeNull();
  });
});

describe("skillDataLines", () => {
  it("writes one line a step, every name and value as data, never a picture's id", () => {
    const s = steps(
      [
        input(field("Amount"), NEW),
        ev("change", control({ tag: "select", role: "combobox", name: "Category", hints: hints({ tag: "select", label: "Category Travel Meals" }) }), NEW),
        click(control({ tag: "input", role: "radio", name: "Medical", group: "Reason", choice: true }), NEW),
        click(control({ name: "<b>Add</b> line" }), NEW),
        click(control({ tag: "a", role: "link", name: "Approve", href: "/approve?id=1" }), LIST),
        click(control({ tag: "a", role: "link", name: "Reports", inNav: true }), LIST),
        click(control({ tag: "a", role: "link", name: "Jane", inRow: "My expenses" }), LIST),
        ev("frame_focus", null, "https://exp.test/pay"),
      ],
      "https://exp.test/new",
      new Map([[shotKey(NEW), "shot_9"]]),
    );
    const r = editSkill(s, [{ id: "s1" }, { id: "s2", value: { fixed: "42.50" } }, { id: "s3" }, { id: "s4" }, { id: "s5" }, { id: "s6" }, { id: "s7", forgetName: true, title: "Open the weekly page" }, { id: "s8" }, { id: "s9" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(skillDataLines(r.steps, "Max")).toEqual([
      "1. Start at https://exp.test/new",
      '2. Type in "Amount" on exp.test/new: "42.50"',
      '3. Choose in "Category" on exp.test/new: asked each time',
      '4. Choose in "Reason" on exp.test/new: asked each time, by clicking the option',
      '5. Click the button "&lt;b&gt;Add&lt;/b&gt; line" on exp.test/new',
      '6. Click the link with "approve" in its words on exp.test/list (it asks first)',
      '7. Go to a link on exp.test/list; Max calls this step "Open the weekly page"',
      '8. Open one item of "My expenses" on exp.test/list: ask Max which',
      "9. Max does this themselves on exp.test/pay: this part is in a box from another site (use ask_to_take_over)",
    ]);
    const lines = skillDataLines(r.steps, "Max").join("\n");
    expect(lines).not.toMatch(/shot_9|Medical|Jane|<b>|Travel|Meals/);
    expect(lines).not.toMatch(BANNED);
  });
});

describe("storedSteps", () => {
  it("drops a step of an unknown kind, an oversized name, a wrong field type or a second id, and keeps the rest as stored", () => {
    const good = steps([click(control({ name: "Save" }), NEW)]);
    const raw = [
      ...good,
      { ...good[1], id: "s3", kind: "teleport" },
      { ...good[1], id: "s4", name: "x".repeat(121) },
      { ...good[1], id: "s5", warnings: ["buys", "steals"] },
      { ...good[1], id: "s6", role: 7 },
      { ...good[1], id: "s2" },
      { id: "s7", kind: "type", title: "Type", site: "exp.test", page: "exp.test/new", shotId: null, name: "Amount", fieldKind: "text", pressEnter: false, value: { fixed: "x".repeat(2001) } },
      { id: "s8", kind: "start", title: "Start", site: "exp.test", page: "exp.test", shotId: null, address: "javascript:alert(1)" },
      { id: "s9", kind: "gap", title: "Gap", site: "", page: "", shotId: "../../etc/passwd" },
      "not a step",
      null,
    ];
    const read = storedSteps(raw);
    expect(read.map((x) => x.id)).toEqual(["s1", "s2", "s9"]);
    expect(read[0]).toEqual(good[0]);
    expect(read[1]).toEqual(good[1]);
    expect(read[2]).toMatchObject({ kind: "gap", shotId: null });
    expect(storedSteps({ not: "a list" })).toEqual([]);
    expect(storedSteps(Array.from({ length: 120 }, () => good[1]))).toHaveLength(1);
  });
});

describe("the step titles (SKILLS_COPY.TITLE)", () => {
  it("give a words-free title for every kind, and hold no dash", () => {
    const s = steps([
      click(control({ name: "Save" }), NEW),
      click(control({ tag: "a", role: "link", name: "Reports", inNav: true }), NEW),
      input(field("Amount"), NEW),
      click(control({ tag: "input", role: "radio", name: "Medical", group: "Reason", choice: true }), NEW),
      click(control({ name: "Jane", inRow: "Rows" }), NEW),
    ]);
    expect(s.map(wordsFreeTitle)).toEqual(["Start on exp.test", "Click the button", "Go to a link", "Type in a field", "Choose an option", "Open an item of the list"]);
    const t = SKILLS_COPY.TITLE;
    const all = [t.start("a.test"), t.link(""), t.link("x"), t.click("", "the button"), t.click("x", "the button"), t.gap, t.type(""), t.type("x"), t.choose(""), t.choose("x"), t.suggestion(""), t.suggestion("x"), t.item(""), t.item("x"), t.yourself("sign_in"), t.yourself("code"), t.yourself("payment"), t.yourself("frame")];
    for (const x of all) expect(x).not.toMatch(BANNED);
    expect(Object.values(SKILLS_COPY.ROLE_WORDS).every((w) => !BANNED.test(w))).toBe(true);
  });
});
