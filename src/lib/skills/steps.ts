// A recording's steps, and what a review may change of them
// (docs/plans/ai-teammates-phase5.md Decisions 7, 11, 17, 18 and 20, step 1).
//
// FROM EVENTS TO STEPS (stepsFromRecording). The recorder hands over the
// person's own input only (page-recorder.ts: trusted, main frame, typing only
// after their own pointer or key on that field), never a value. Each event is
// read here to build steps and dropped; only SkillStep is kept. In recorded
// order:
//   - the start step first, at recordableAddress(startUrl);
//   - THE FOLD, before any naming: an act in a form that holds a password,
//     code, card or bank field (classes.ts isSensitiveField over every
//     field's hints, typed in or not, before or after the act; for a control
//     with no form element, the page's fields) is one step the person does
//     themselves, by the most sensitive kind there (card or bank: payment;
//     a code: code; a password: sign_in). Once focus entered a frame from
//     another site on a page, every act on that page from then until the
//     next page is one such step too (payment when any click on that page
//     warned that it buys, else frame). Consecutive steps of one reason on
//     one page are one. Nothing about the field is kept;
//   - typing in one field until another control is used is one "type" step
//     named by the field's label (an Enter in it sets pressEnter); a click on
//     a field, or on a native list, is dropped (the typing or the choice
//     covers it); a change of a native list is one "choose" step (via list)
//     named by its label. A field's or list's label is the words a person
//     sees (its name, else its group's), NEVER the reader's label hint
//     (hints.label), which holds every word of its labels, seen or not: a
//     wrapped select's options, a wrapped textarea's typed text;
//   - every other click is named by Decision 7's rules IN THIS ORDER, the
//     first that applies deciding:
//       1. it acts (an action word in its words, a buys, sends, deletes or
//          terms warning, or a link whose address acts): a "click" step named
//          by the action word only, or by its role when only a warning or its
//          address matched, wherever it sits (a menu, a row, a grid); a
//          suggestion's words, and words that echo the typing, are never read
//          for it, so it acts only by its page or its address;
//       then a suggestion that is no choice (rule 4 below), before rule 2,
//          so a search box's live result drawn as a nav link or a menu item
//          never keeps its words;
//       2. a plain menu item, or a link in navigation, a menu bar or a tab
//          list, neither a choice nor a suggestion: a "click" (or "link")
//          step that keeps its words;
//       3. a choice (a radio, an option, a menu choice, a tree item, a grid
//          cell, a grouped checkbox or switch, anything in a listbox, grid,
//          tree, date picker or combobox popup): a "choose" step (via click)
//          named by its group's label, never by the option; the click that
//          opened its popup just before it is dropped;
//          an opener that no choice follows (a combobox, aria-haspopup) is a
//          "click" step named by its label only, never its shown words;
//       4. a suggestion (a control that came in after the person's counted
//          typing): a "choose" step (via suggestion) named by the field typed
//          in before it, or by no words when none was (checked before rule
//          2 when it is no choice; a choice that is one is named by rule 3);
//       5. anything else in a row of data or a list that is not navigation: a
//          "choose" step (via item) named by the list's label;
//       6. anything else: a "link" step or a "click" step by its words.
//   - a kept name holding an email, a phone number or 4 or more digits keeps
//     only its role, and so does a control whose words changed after the
//     person's counted typing (a button that echoes it), so no word they
//     typed is kept;
//   - every value is asked each time; at most 100 steps.
//
// THE EVENTS KEPT (keepRecorded, review of Phase 5 step 2, M1): the server
// keeps a recording's events in memory with a field's repeated typing folded
// (the same control on the same page, right after its own input or Enter:
// the same "type" step either way), at most 400; past it, one gap where the
// first was dropped, so nothing done later is lost without a step saying so.
//
// WHAT A REVIEW MAY CHANGE (editSkill, Decision 11): titles, which steps stay
// (never added or moved), a step's words removed (forgetName, its title back
// to its words-free default unless the same save sends one, and a title
// still holding the removed words refused), the start shortened to the
// site's home, and each typing or choosing step's value. Every other field
// comes from the stored step, so no edit writes a site, an address, an
// element or a name the recording did not give.
//
// THE DATA LINES (skillDataLines) are the words block 2 and use_skill give
// the model of a skill (step 4), every name and value as data: model-facing
// prompt lines, kept here beside the steps they read since this module is
// pure and engine.ts is not.
//
// Pure: no database, no browser. Safe on the client.

import { clampText } from "@/lib/agents/clamp";
import { plainData } from "@/lib/agents/plain-data";
import { SKILLS_COPY, YOURSELF_WORDS } from "@/lib/agents/teammate-copy";
import { ACTION_WORDS, CLICK_WARNINGS, actingAddress, actingWords, clickWarnings, fieldKindOf, type ClickWarning, type FieldHints } from "@/lib/browser/classes";
import { redactPageText } from "@/lib/browser/redact";
import { FIELD_KINDS, type FieldKind } from "@/lib/browser/types";
import { CHOOSE_VIAS, SKILL_LIMITS, SKILL_STEP_KINDS, YOURSELF_REASONS, type ChooseVia, type RecordedControl, type RecordedEvent, type SkillStep, type SkillValue, type YourselfReason } from "./types";

const L = SKILL_LIMITS;

/** The longest a step's page words are (its host and first path part). */
const PAGE_MAX = 300;
/** The longest a name is inside a title, so the title keeps its closing quote within stepTitleMax. */
const TITLE_NAME_MAX = 100;
/** The longest role, tag and type a click step keeps. */
const ROLE_MAX = 40;
const HOST_MAX = 253;
const ADDRESS_MAX = 2000;
/** A step's id: "s" and its place in the recording. */
const STEP_ID = /^s[1-9]\d{0,3}$/;
/** A picture's id, as shotSrc reads one (browser/views.ts). */
const SHOT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOST = /^[a-z0-9._-]{1,253}$/;

// ── Words ───────────────────────────────────────────────────────────

/** Control characters (C0, DEL, C1) and line and paragraph separators. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/** One line, plain (plain-data.ts), its runs of white space made one. */
function oneLine(s: unknown): string {
  return plainData(typeof s === "string" ? s : "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text with its escapes decoded, as the page meant it; the raw text when they are not valid. */
function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+/u;
const DIGITS_4 = /\p{Nd}{4,}/u;
/** A phone number's shape: digits with spaces, dots, hyphens, slashes or brackets between them. */
const PHONE = /[+(]?\p{Nd}[\p{Nd}\s().\-\/]{5,}\p{Nd}/gu;
/**
 * A run long enough to be a token: letters, digits, "_" and "-", the
 * base64url and UUID alphabets (review of Phase 5 step 1: "-" and "_" broke
 * the run, so "9fK2mQ7x-L4pR8sT1vW3y" passed as two short parts).
 */
const TOKEN_RUN = /[\p{L}\p{N}_-]{16,}/gu;
/** A UUID's shape (8 hex, "-", 4 hex, "-"), wherever it starts. */
const UUID_START = /[0-9a-f]{8}-[0-9a-f]{4}-/i;
/** A run of 12 or more hex characters (an id, a hash, a UUID's last group). */
const HEX_RUN = /[0-9a-f]{12,}/i;

/** Whether text holds a phone number: a run of digits and separators with 7 or more digits. */
function holdsPhone(text: string): boolean {
  for (const m of text.matchAll(PHONE)) if ((m[0].match(/\p{Nd}/gu) ?? []).length >= 7) return true;
  return false;
}

/**
 * Whether text holds a token or an id: a run of 16 or more letters, digits,
 * "_" and "-" that mixes letters and digits, a UUID's shape, or a run of 12
 * or more hex characters. A harmless slug that matches only shortens a
 * start page to the site's home.
 */
function holdsToken(text: string): boolean {
  if (UUID_START.test(text) || HEX_RUN.test(text)) return true;
  for (const m of text.matchAll(TOKEN_RUN)) if (/\p{L}/u.test(m[0]) && /\p{N}/u.test(m[0])) return true;
  return false;
}

/**
 * A control's words as a step keeps them (Decision 7): one line, plain, at
 * most 120; "" when they hold an email address, a phone number, a run of 4
 * or more digits, or anything the redaction would hide, so the step keeps
 * only its role ("the button").
 */
export function keptName(name: string): string {
  const t = oneLine(name);
  if (!t) return "";
  if (EMAIL.test(t) || DIGITS_4.test(t) || holdsPhone(t)) return "";
  if (redactPageText(t).hidden > 0) return "";
  return clampText(t, L.stepTitleMax).trim();
}

/** A control's role as a step's words say it ("the button"). */
export function roleWords(role: string): string {
  const r = String(role ?? "").toLowerCase();
  const words = SKILLS_COPY.ROLE_WORDS as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(words, r) ? words[r] : words.other;
}

/** A name or text compared as a person would: plain, one line, lower case, its spaces made one. */
export function normName(s: string): string {
  return oneLine(s).toLowerCase();
}

// ── Addresses ───────────────────────────────────────────────────────

/** A parsed http(s) address, or null. */
function webUrl(url: string): URL | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 8192) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  return u.protocol === "https:" || u.protocol === "http:" ? u : null;
}

/** An address's host, lower case with one trailing dot dropped; "" when it is no web page. */
function hostOf(url: string): string {
  const u = webUrl(url);
  return u ? u.hostname.toLowerCase().replace(/\.$/, "") : "";
}

/**
 * The key a page's picture is kept under while recording (step 2's poll
 * and stepsFromRecording's pageShots): its address with the fragment
 * dropped, as browser-rules.ts pageKey reads it.
 */
export function shotKey(url: string): string {
  const u = webUrl(url);
  if (!u) return typeof url === "string" ? url : "";
  u.hash = "";
  return u.href;
}

/**
 * Whether one decoded path part looks like an id or a token (Decision 7): an
 * email address (or any "@", a person's handle), a run of 4 or more digits,
 * a ";" parameter, a run of 16 or more letters, digits, "_" and "-" mixing
 * letters and digits, a UUID's shape, a run of 12 or more hex characters
 * (holdsToken), or anything the redaction would hide.
 */
function idLikePart(part: string): boolean {
  if (part.includes("@") || part.includes(";")) return true;
  if (DIGITS_4.test(part) || holdsToken(part)) return true;
  return redactPageText(plainData(part)).hidden > 0;
}

/**
 * The start page a skill keeps (Decision 7): origin and path, never a query
 * or a fragment; the site's home (origin and "/") when any path part looks
 * like an id or a token, when the redaction would hide anything in the
 * path, or when the address looks like an action (actingAddress over the
 * whole address, so a start is never refused by Decision 18). Never empty
 * for a web page; "" only for an address that is none (about:blank), which
 * the record route refuses before a recording starts.
 */
export function recordableAddress(url: string): string {
  const u = webUrl(url);
  if (!u) return "";
  const home = `${u.origin}/`;
  if (actingAddress(url)) return home;
  const raw = u.pathname;
  if (raw.includes(";")) return home;
  if (redactPageText(plainData(decoded(raw))).hidden > 0) return home;
  for (const part of raw.split("/")) if (part && idLikePart(decoded(part))) return home;
  const kept = `${u.origin}${raw}`;
  return kept.length <= ADDRESS_MAX ? kept : home;
}

/**
 * Where a step happened, as it keeps it (Decision 7): the host and the first
 * path part, a part that looks like an id or a token shown as "*"; "" when
 * the address is no web page.
 */
export function stepPage(url: string): string {
  const u = webUrl(url);
  if (!u) return "";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const first = u.pathname.split("/").find((p) => p.length > 0);
  if (!first) return clampText(host, PAGE_MAX);
  const part = decoded(first);
  const shown = idLikePart(part) ? "*" : oneLine(part) || "*";
  return clampText(`${host}/${shown}`, PAGE_MAX);
}

/** An address's path, for the click warnings that read it ("/checkout"). */
function pathOf(url: string): string {
  const u = webUrl(url);
  return u ? decoded(u.pathname) : "";
}

// ── Titles ──────────────────────────────────────────────────────────

const T = SKILLS_COPY.TITLE;

function titled(s: string): string {
  return clampText(oneLine(s), L.stepTitleMax).trim();
}

/** A name as a title quotes it. */
function inTitle(name: string): string {
  return clampText(name, TITLE_NAME_MAX).trim();
}

/** A step's title as a recording gives it, from its kept words (and its words-free title when it keeps none). */
function titleOf(s: SkillStep): string {
  switch (s.kind) {
    case "start":
      return titled(T.start(s.page));
    case "link":
      return titled(T.link(inTitle(s.name)));
    case "click":
      return titled(T.click(inTitle(s.name), roleWords(s.role)));
    case "type":
      return titled(T.type(inTitle(s.name)));
    case "choose":
      if (s.via === "suggestion") return titled(T.suggestion(inTitle(s.name)));
      if (s.via === "item") return titled(T.item(inTitle(s.name)));
      return titled(T.choose(inTitle(s.name)));
    case "yourself":
      return titled(T.yourself(s.reason));
    case "gap":
      return titled(T.gap);
  }
}

/** The title a step goes back to when its page's words are removed (forgetName, Decision 11): "Click the button", "Go to a link", "Choose an option". */
export function wordsFreeTitle(s: SkillStep): string {
  return "name" in s ? titleOf({ ...s, name: "" } as SkillStep) : titleOf(s);
}

// ── From a recording to steps ───────────────────────────────────────

/** Roles a person clicks, never types in. */
const NOT_TYPED_ROLES: ReadonlySet<string> = new Set(["radio", "checkbox", "switch", "button", "link", "option", "menuitem", "menuitemradio", "menuitemcheckbox", "slider", "tab", "treeitem", "gridcell"]);

/**
 * Whether a control takes typing: a text-like input (a combobox one too), a
 * textarea, or an editable region a reader calls a text box. A button that
 * opens a list (role combobox on a button) does not: it is an opener.
 */
function takesTyping(c: RecordedControl): boolean {
  const tag = (c.tag ?? "").toLowerCase();
  const role = (c.role ?? "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "select" || tag === "option") return false;
  // A control a person clicks rather than types in, whatever its tag.
  if (NOT_TYPED_ROLES.has(role)) return false;
  if (tag === "input") {
    const k = fieldKindOf({ ...c.hints, tag: "input", type: c.type ?? c.hints?.type ?? null });
    return k !== "checkbox" && k !== "radio" && k !== "file" && k !== "none" && k !== "select";
  }
  return role === "textbox" || role === "searchbox";
}

/** A native list, or one of its options: its choice is the "change" that follows. */
function isNativeList(c: RecordedControl): boolean {
  const tag = (c.tag ?? "").toLowerCase();
  return tag === "select" || tag === "option";
}

function isLink(c: RecordedControl): boolean {
  return (c.role ?? "").toLowerCase() === "link" || ((c.tag ?? "").toLowerCase() === "a" && !c.role);
}

/** A control's role as a click step keeps it. */
function roleOf(c: RecordedControl): string {
  const r = oneLine(c.role).toLowerCase();
  if (r) return clampText(r, ROLE_MAX);
  return (c.tag ?? "").toLowerCase() === "a" ? "link" : "button";
}

/**
 * A field's or a native list's label, as a step keeps it: the words a person
 * sees, its visible name by the reader's rules, else its group's label; for
 * an opener (a combobox) its group's label first, since its shown words can
 * be its current value.
 *
 * NEVER `hints.label` (review of Phase 5 step 1, high): that is the
 * reader's label hint, every word of the field's labels whether seen or not
 * (page-reader.ts labelHint, the labels' textContent), so a label wrapping
 * a select holds every option ("Approver Jane Doe Sam Ortiz") and one
 * wrapping a React textarea holds what was typed. It is read only to class
 * the field (fieldKindOf) and for the fold, never kept.
 */
function fieldLabel(c: RecordedControl): string {
  return c.opener ? oneLine(c.group) || oneLine(c.name) : oneLine(c.name) || oneLine(c.group);
}

/**
 * Which control an event was on, as far as the events can tell two apart:
 * its tag, type, form, group, name and id attributes, role and visible
 * name. Never `hints.label`, whose words change as a person types in a
 * field its label wraps, so each keystroke would be a step of its own.
 */
function controlKey(c: RecordedControl): string {
  return JSON.stringify([c.tag, c.type, c.formKey, c.group, c.hints?.name ?? null, c.hints?.id ?? null, c.role, c.name]);
}

/**
 * Whether `next` repeats the typing just kept: an input on the same control
 * (controlKey) on the same page (shotKey), right after that control's own
 * input or Enter. stepsFromRecording folds it into the same "type" step, so
 * keeping it adds nothing but a place under the cap.
 */
function repeatsTyping(prev: RecordedEvent | undefined, next: RecordedEvent): boolean {
  if (!prev || next.type !== "input" || (prev.type !== "input" && prev.type !== "enter")) return false;
  if (!prev.control || !next.control || typeof prev.page !== "string" || typeof next.page !== "string") return false;
  return shotKey(prev.page) === shotKey(next.page) && controlKey(prev.control) === controlKey(next.control);
}

/**
 * The person's input as a recording keeps it in memory (recorder.ts collect;
 * review of Phase 5 step 2, M1): each new event appended to `kept`, but one
 * that repeats the typing before it (a field typed in key by key is one
 * event, whatever the page sent), at most `max`. Past it nothing more is
 * kept, and one "may be missing" event stands where the first was dropped,
 * so a loss is never silent (Decision 7). Answers how many it added and
 * whether the recording is full.
 */
export function keepRecorded(kept: RecordedEvent[], incoming: readonly RecordedEvent[], max: number): { added: number; full: boolean } {
  let added = 0;
  for (const e of Array.isArray(incoming) ? incoming : []) {
    if (!e || typeof e !== "object" || typeof e.type !== "string") continue;
    if (repeatsTyping(kept[kept.length - 1], e)) continue;
    if (kept.length >= max) {
      if (kept.length === max) {
        kept.push({ type: "gap", control: null, at: typeof e.at === "number" ? e.at : Date.now(), page: typeof e.page === "string" ? e.page : "" });
        added += 1;
      }
      break;
    }
    kept.push(e);
    added += 1;
  }
  return { added, full: kept.length > max };
}

const FOLD_RANK: Readonly<Record<YourselfReason, number>> = { frame: 0, sign_in: 1, code: 2, payment: 3 };

/** The most sensitive kind among a form's fields (Decision 7's fold), or null when none is. */
function foldReason(fields: readonly FieldHints[]): YourselfReason | null {
  let best: YourselfReason | null = null;
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    const k = fieldKindOf(f);
    const r: YourselfReason | null =
      k === "card_number" || k === "card_code" || k === "card_expiry" || k === "bank_account" ? "payment" : k === "one_time_code" ? "code" : k === "password" ? "sign_in" : null;
    if (r && (!best || FOLD_RANK[r] > FOLD_RANK[best])) best = r;
  }
  return best;
}

/**
 * The words a control is classed by (rule 1 and the warnings): its own, or,
 * for an opener (a combobox, aria-haspopup), its label only, since its shown
 * words are its current value, which is never kept or read for a step; and
 * none for a control whose words changed after the person's counted typing,
 * since they echo it (no class, action word or warning of a step comes from
 * what the person typed), nor for a suggestion (review of Phase 5 step 1),
 * whose words came in with the typing ("Search for 'cancel my order'"). A
 * suggestion still waits on its own click card when it runs.
 */
function classWords(c: RecordedControl): string {
  if (c.wordsChanged || c.suggestion) return "";
  return c.opener ? (c.group ?? "") : (c.name ?? "");
}

/** The click warnings a control's card would carry, by its words and its page's path (Phase 4's clickWarnings). */
function warningsOf(c: RecordedControl, page: string): ClickWarning[] {
  return clickWarnings(
    { tag: c.tag ?? "", role: roleOf(c), name: classWords(c), kind: c.hints ? fieldKindOf(c.hints) : "none", type: c.type, formHost: c.formHost, href: c.href, twin: 0, twins: 1, anchor: "", at: 0 },
    { path: pathOf(page), formHasSensitive: false, downloadLink: false },
  );
}

const ACTS: ReadonlySet<ClickWarning> = new Set<ClickWarning>(["buys", "sends", "deletes", "terms"]);

/** What one page, as a run of events on one address, tells the fold: where focus entered a frame, and whether any click there warned that it buys. */
interface PageRun {
  framedFrom: number;
  buys: boolean;
}

/** Omit over each member of a union, keeping the union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A step being built, before its id, title and where it was. */
type Draft = DistributiveOmit<SkillStep, "id" | "title" | "site" | "page" | "shotId">;

/**
 * The steps of a recording (see the file header). `pageShots` gives the
 * picture kept for each page, by shotKey(address). Ids "s1" and on, in
 * recorded order; every value asked each time; at most recordedStepsMax.
 */
export function stepsFromRecording(r: { startUrl: string; events: readonly RecordedEvent[]; pageShots: ReadonlyMap<string, string> }): SkillStep[] {
  const out: SkillStep[] = [];
  const shotOf = (url: string): string | null => {
    const id = r.pageShots.get(shotKey(url));
    return typeof id === "string" && SHOT_ID.test(id) ? id : null;
  };
  const push = (d: Draft, page: string): SkillStep | null => {
    if (out.length >= L.recordedStepsMax) return null;
    const base = { ...d, site: hostOf(page), page: stepPage(page), shotId: shotOf(page) } as SkillStep;
    const step = { ...base, id: `s${out.length + 1}`, title: "" } as SkillStep;
    step.title = titleOf(step);
    out.push(step);
    return step;
  };

  const start = recordableAddress(r.startUrl);
  if (start) push({ kind: "start", address: start }, r.startUrl);

  const events = Array.isArray(r.events) ? r.events.filter((e) => e && typeof e === "object" && typeof e.type === "string") : [];

  // First pass: each run of events on one page, for the frame fold (it reads clicks after the focus too).
  const runOf: number[] = [];
  const runs: PageRun[] = [];
  let lastKey: string | null = null;
  events.forEach((e, i) => {
    const key = shotKey(e.page);
    if (key !== lastKey) {
      runs.push({ framedFrom: Number.POSITIVE_INFINITY, buys: false });
      lastKey = key;
    }
    const run = runs[runs.length - 1];
    runOf[i] = runs.length - 1;
    if (e.type === "frame_focus" && i < run.framedFrom) run.framedFrom = i;
    if (e.type === "click" && e.control && warningsOf(e.control, e.page).includes("buys")) run.buys = true;
  });

  // Second pass: the steps.
  let typing: { key: string; step: Extract<SkillStep, { kind: "type" }> } | null = null;
  let lastTyped: string | null = null;
  let pendingOpener: { draft: Draft; page: string } | null = null;
  let lastPage = r.startUrl;
  let lastRun = -1;
  const last = () => out[out.length - 1];
  const flushOpener = () => {
    if (pendingOpener) push(pendingOpener.draft, pendingOpener.page);
    pendingOpener = null;
  };
  const yourself = (reason: YourselfReason, page: string) => {
    flushOpener();
    typing = null;
    const prev = last();
    if (prev && prev.kind === "yourself" && prev.reason === reason && prev.page === stepPage(page) && prev.site === hostOf(page)) return;
    push({ kind: "yourself", reason }, page);
  };

  events.forEach((e, i) => {
    const run = runs[runOf[i]];
    if (runOf[i] !== lastRun) {
      // A new page: what was open on the last one is done.
      flushOpener();
      typing = null;
      lastTyped = null;
      lastRun = runOf[i];
    }
    const page = hostOf(e.page) ? e.page : lastPage;
    if (hostOf(e.page)) lastPage = e.page;

    if (e.type === "gap") {
      flushOpener();
      typing = null;
      const prev = last();
      if (prev && prev.kind === "gap" && prev.page === stepPage(page)) return;
      push({ kind: "gap" }, page);
      return;
    }
    // Nothing is recorded off a web page.
    if (!hostOf(e.page)) return;

    // Focus went into a frame from another site: from here to the next page, the person's.
    if (i >= run.framedFrom) {
      yourself(run.buys ? "payment" : "frame", page);
      return;
    }
    const c = e.control;
    if (!c || typeof c !== "object") return;
    if (e.type !== "click" && e.type !== "input" && e.type !== "change" && e.type !== "enter") return;

    // A sign-in, code or payment form: the person's, by its structure (Decision 7).
    const fields = [...(Array.isArray(c.formFields) ? c.formFields : []), ...(c.hints ? [c.hints] : [])];
    const sensitive = foldReason(fields);
    if (sensitive) {
      yourself(sensitive, page);
      return;
    }

    const key = controlKey(c);
    if (e.type === "input" || e.type === "enter") {
      if (!takesTyping(c)) return;
      const open = typing as { key: string; step: Extract<SkillStep, { kind: "type" }> } | null;
      if (open && open.key === key) {
        if (e.type === "enter") open.step.pressEnter = true;
        return;
      }
      flushOpener();
      const kind = fieldKindOf(c.hints);
      const label = fieldLabel(c);
      const step = push({ kind: "type", name: c.wordsChanged ? "" : keptName(label), fieldKind: kind === "none" ? "text" : kind, pressEnter: e.type === "enter", value: { ask: true } }, page);
      typing = step && step.kind === "type" ? { key, step } : null;
      // A field whose own words echo the typing names no suggestion either (review of Phase 5 step 1).
      lastTyped = c.wordsChanged ? "" : label;
      return;
    }

    if (e.type === "change") {
      // Only a native list's change is a choice; a field's change after typing is the typing's.
      if ((c.tag ?? "").toLowerCase() !== "select") return;
      flushOpener();
      typing = null;
      const name = keptName(fieldLabel(c));
      const prev = last();
      if (prev && prev.kind === "choose" && prev.via === "list" && prev.name === name && prev.page === stepPage(page)) return;
      push({ kind: "choose", via: "list", name, value: { ask: true } }, page);
      return;
    }

    // A click. On a field or a native list it is covered by the typing or the choice that follows.
    if (takesTyping(c) || isNativeList(c)) {
      const open = typing as { key: string } | null;
      if (!open || open.key !== key) typing = null;
      return;
    }
    typing = null;
    const role = roleOf(c);
    const warnings = warningsOf(c, page);

    // 1. It acts: a click step named by its action word only, wherever it sits.
    const word = actingWords(classWords(c));
    const acts = word !== null || warnings.some((w) => ACTS.has(w)) || (isLink(c) && typeof c.href === "string" && actingAddress(c.href));
    if (acts) {
      flushOpener();
      push({ kind: "click", role, name: word && !c.wordsChanged ? word : "", tag: tagOf(c), type: typeOf(c), formHost: formHostOf(c), warnings }, page);
      return;
    }
    // 4, before 2 (review of Phase 5 step 1). A suggestion that is no choice,
    // named by the field typed in before it, never by its own words or its
    // group's, which came in with the typing: a search box's live results
    // drawn as links in a nav bar, or as menu items, are suggestions too.
    if (c.suggestion && !c.choice) {
      flushOpener();
      push({ kind: "choose", via: "suggestion", name: keptName(lastTyped ?? ""), value: { ask: true } }, page);
      return;
    }
    // 2. A plain menu item, or a link in navigation, a menu bar or a tab list
    // (neither a choice nor a suggestion): its words.
    if (!c.choice && !c.suggestion && (role === "menuitem" || (isLink(c) && c.inNav))) {
      flushOpener();
      const name = c.wordsChanged ? "" : keptName(c.name);
      if (isLink(c)) push({ kind: "link", name }, page);
      else push({ kind: "click", role, name, tag: tagOf(c), type: typeOf(c), formHost: formHostOf(c), warnings }, page);
      return;
    }
    // 3. A choice, named by its list; the click that opened its popup goes with it.
    if (c.choice) {
      pendingOpener = null;
      const name = c.wordsChanged ? "" : keptName(c.group ?? "");
      const prev = last();
      if (prev && prev.kind === "choose" && prev.via === "click" && prev.name === name && prev.page === stepPage(page)) return;
      push({ kind: "choose", via: "click", name, value: { ask: true } }, page);
      return;
    }
    // An opener no choice has followed yet: by its label only, never its shown words (its value), held for the choice after it.
    if (c.opener) {
      flushOpener();
      const name = c.inRow !== null || c.wordsChanged ? "" : keptName(c.group ?? "");
      pendingOpener = { draft: { kind: "click", role, name, tag: tagOf(c), type: typeOf(c), formHost: formHostOf(c), warnings }, page };
      return;
    }
    flushOpener();
    // 5. An item of a list, named by the list.
    if (c.inRow !== null && c.inRow !== undefined) {
      push({ kind: "choose", via: "item", name: keptName(c.inRow), value: { ask: true } }, page);
      return;
    }
    // 6. Anything else, by its words (its role only when they echo the person's typing).
    const name = c.wordsChanged ? "" : keptName(c.name);
    if (isLink(c)) push({ kind: "link", name }, page);
    else push({ kind: "click", role, name, tag: tagOf(c), type: typeOf(c), formHost: formHostOf(c), warnings }, page);
  });
  flushOpener();
  return out;
}

function tagOf(c: RecordedControl): string {
  return clampText(oneLine(c.tag).toLowerCase(), ROLE_MAX) || "button";
}

function typeOf(c: RecordedControl): string | null {
  const t = oneLine(c.type).toLowerCase();
  return t ? clampText(t, ROLE_MAX) : null;
}

function formHostOf(c: RecordedControl): string | null {
  const h = oneLine(c.formHost).toLowerCase();
  return h && HOST.test(h) ? h : null;
}

// ── Values ──────────────────────────────────────────────────────────

export type FixedValueProblem = "sensitive" | "control" | "empty" | "too_long";

/** Every decimal digit of any script as its ASCII digit: Unicode encodes each set of ten in a row, 0 first, so a digit is its distance from where its run of digits starts, modulo 10. */
function asciiDigits(t: string): string {
  return t.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) ?? 48;
    if (cp <= 57) return ch;
    let start = cp;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((cp - start) % 10);
  });
}

/** An IBAN's shape in any case; a match counts only with 12 digits or more (2 check digits and a bank number), so words never do. */
const IBAN_ANY_CASE = /\b[a-z]{2}\d{2}(?: ?[a-z0-9]){11,30}\b/gi;

/**
 * Whether words a person typed for a skill (a fixed value, a name, what it
 * is for) hold anything the redaction would hide (review of step 3): as
 * typed; with its runs of white space made one; and as a site may read it,
 * with compatibility forms made plain (NFKC: full-width digits and letters),
 * every script's digits as ASCII digits and any 1 to 4 characters between
 * two digits that are neither letters nor digits ("4242.4242/4242") one
 * space; and an IBAN in any case.
 */
export function holdsSensitive(text: string): boolean {
  const t = typeof text === "string" ? text : "";
  if (!t) return false;
  if (redactPageText(t).hidden > 0) return true;
  const spaced = t.replace(/\s+/g, " ");
  if (redactPageText(spaced).hidden > 0) return true;
  const plain = asciiDigits(spaced.normalize("NFKC")).replace(/(?<=\d)[^\p{L}\p{N}]{1,4}(?=\d)/gu, " ");
  if (redactPageText(plain).hidden > 0) return true;
  for (const m of plain.matchAll(IBAN_ANY_CASE)) if ((m[0].match(/\d/g)?.length ?? 0) >= 12) return true;
  return false;
}

/** Characters a fixed value never holds: control characters, separators that would press Enter, and the invisible ones that hide or reorder words. */
const UNTYPEABLE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/;

/**
 * Why a value the person typed at review can't be kept (Decision 11), or
 * null: anything the redaction would hide (a card number, a code next to a
 * code word, an IBAN), in any of the forms holdsSensitive reads, is
 * "sensitive"; a control character, a line break or
 * an invisible character "control"; nothing after trimming "empty"; past
 * 2,000 characters (80 for a choice) "too_long".
 */
export function fixedValueProblem(text: string, kind: "type" | "choose"): FixedValueProblem | null {
  const t = typeof text === "string" ? text : "";
  if (holdsSensitive(t)) return "sensitive";
  if (UNTYPEABLE.test(t)) return "control";
  if (!t.trim()) return "empty";
  if (t.trim().length > (kind === "choose" ? L.fixedOptionMax : L.fixedTextMax)) return "too_long";
  return null;
}

// ── A review's edit ─────────────────────────────────────────────────

/**
 * Why an edit was refused: an id not stored (`unknown_step`), out of their
 * stored order or twice (`order`), a title empty, too long or still holding
 * the words it removes (`title`, with `titleProblem`), a value on a step that neither types nor
 * chooses or one that can't be kept (`value`, with `valueProblem`), no step
 * left (`empty`), more than 50 (`too_many`), or the start step left out
 * (`start`: a run always starts there, Decision 17).
 */
export type EditProblem = "unknown_step" | "order" | "title" | "value" | "empty" | "too_many" | "start";

export type EditKeep = { id: string; title?: string; value?: SkillValue; forgetName?: true };

/** Why a title was refused (review of step 3: each its own words): empty, past 120 characters, or holding the page's words the person removed. */
export type TitleProblem = "empty" | "too_long" | "removed";

export type EditResult = { ok: true; steps: SkillStep[] } | { ok: false; problem: EditProblem; stepId?: string; valueProblem?: FixedValueProblem; titleProblem?: TitleProblem };

function isValue(v: unknown): v is SkillValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && o.ask === true) return true;
  return keys.length === 1 && typeof o.fixed === "string";
}

/**
 * The steps a review saves (Decision 11, see the file header): the kept ids
 * in their stored order, each with only its title, its value and
 * forgetName; every other field from the stored step. `startHome` makes the
 * start step's address its site's home.
 */
export function editSkill(stored: readonly SkillStep[], keep: ReadonlyArray<EditKeep>, o: { startHome?: true } = {}): EditResult {
  const at = new Map<string, number>();
  stored.forEach((s, i) => at.set(s.id, i));
  if (!Array.isArray(keep)) return { ok: false, problem: "empty" };
  let after = -1;
  const out: SkillStep[] = [];
  for (const k of keep) {
    const id = k && typeof k === "object" && typeof k.id === "string" ? k.id : "";
    const i = at.get(id);
    if (i === undefined) return { ok: false, problem: "unknown_step", stepId: id || undefined };
    if (i <= after) return { ok: false, problem: "order", stepId: id };
    after = i;
    const was = stored[i];
    let step: SkillStep = { ...was, ...("warnings" in was ? { warnings: [...was.warnings] } : {}), ...("value" in was ? { value: { ...was.value } } : {}) } as SkillStep;

    if (k.value !== undefined) {
      if (step.kind !== "type" && step.kind !== "choose") return { ok: false, problem: "value", stepId: id };
      if (!isValue(k.value)) return { ok: false, problem: "value", stepId: id };
      if ("fixed" in k.value) {
        const problem = fixedValueProblem(k.value.fixed, step.kind);
        if (problem) return { ok: false, problem: "value", stepId: id, valueProblem: problem };
        step = { ...step, value: { fixed: k.value.fixed.trim() } };
      } else {
        step = { ...step, value: { ask: true } };
      }
    }

    const removed = k.forgetName === true && "name" in step ? step.name : "";
    if (k.forgetName === true && "name" in step) step = { ...step, name: "" } as SkillStep;

    if (k.title !== undefined) {
      if (typeof k.title !== "string") return { ok: false, problem: "title", stepId: id, titleProblem: "empty" };
      const title = oneLine(k.title);
      if (!title) return { ok: false, problem: "title", stepId: id, titleProblem: "empty" };
      if (title.length > L.stepTitleMax) return { ok: false, problem: "title", stepId: id, titleProblem: "too_long" };
      // No stored field keeps the words a person removed (Decision 11).
      if (removed && normName(title).includes(normName(removed))) return { ok: false, problem: "title", stepId: id, titleProblem: "removed" };
      step = { ...step, title };
    } else if (k.forgetName === true && "name" in step) {
      step = { ...step, title: wordsFreeTitle(step) };
    }

    if (o.startHome === true && step.kind === "start") {
      const u = webUrl(step.address);
      if (u) {
        // Its page and, unless the person named the step, its title follow the home address (review of step 3).
        const home = `${u.origin}/`;
        const named = k.title !== undefined || step.title !== titleOf(was);
        step = { ...step, address: home, page: stepPage(home) };
        if (!named) step = { ...step, title: titleOf(step) };
      }
    }
    out.push(step);
  }
  const startStep = stored.find((s) => s.kind === "start");
  if (startStep && !out.some((s) => s.id === startStep.id)) return { ok: false, problem: "start", stepId: startStep.id };
  if (out.length < 1) return { ok: false, problem: "empty" };
  if (out.length > L.stepsMax) return { ok: false, problem: "too_many" };
  return { ok: true, steps: out };
}

// ── Sites and matching ──────────────────────────────────────────────

/** The hosts a skill's steps touch, once each in the order first met, at most sitesMax (TeammateSkill.sites). */
export function skillSites(steps: readonly SkillStep[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (!s.site || out.includes(s.site)) continue;
    out.push(s.site);
    if (out.length >= L.sitesMax) break;
  }
  return out;
}

/** The hosts a skill's steps touch that may not be opened now (Decision 12), once each in the order first met. */
export function sitesNotAllowed(steps: readonly SkillStep[], allowed: (host: string) => boolean): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (!s.site || out.includes(s.site)) continue;
    if (!allowed(s.site)) out.push(s.site);
  }
  return out;
}

/** An act a card in a skill run would do, as matchStep compares it (Decision 20). */
export type ActShape = { kind: "click"; site: string; role: string; name: string; choiceRole: boolean } | { kind: "type" | "choose"; site: string; name: string };

const ACTION_SET: ReadonlySet<string> = new Set(ACTION_WORDS);

/** Whether `words` hold `word` as a whole word. */
function holdsWord(words: string, word: string): boolean {
  return normName(words)
    .split(/[^\p{L}\p{N}]+/u)
    .includes(word);
}

/**
 * The next step of the skill this act matches (Decision 20), its index, or
 * null: the first step after index `after` of the same kind (type_text to
 * "type", select_option to "choose" via list, a click on a choice role to
 * "choose" via click, suggestion or item, any other click to "click"), on
 * the same host, with the same words where the step keeps any (a step named
 * by its action word: the control's words hold that word whole), and for a
 * click the same role. A choice's step is named by its list and the act by
 * its option, so they are not compared by words. Never across hosts, never
 * backwards. It informs a card; it never lets anything run.
 */
export function matchStep(steps: readonly SkillStep[], after: number, act: ActShape): number | null {
  const from = Number.isInteger(after) && after >= -1 ? after + 1 : 0;
  const site = String(act.site ?? "").toLowerCase();
  const name = normName(act.name ?? "");
  for (let i = from; i < steps.length; i += 1) {
    const s = steps[i];
    if (s.site !== site) continue;
    if (act.kind !== "click") {
      if (act.kind === "type" && s.kind === "type" && (!s.name || normName(s.name) === name)) return i;
      if (act.kind === "choose" && s.kind === "choose" && s.via === "list" && (!s.name || normName(s.name) === name)) return i;
      continue;
    }
    if (act.choiceRole) {
      if (s.kind === "choose" && s.via !== "list") return i;
      continue;
    }
    if (s.kind !== "click" || s.role !== String(act.role ?? "").toLowerCase()) continue;
    if (!s.name) return i;
    if (ACTION_SET.has(s.name) ? holdsWord(act.name ?? "", s.name) : normName(s.name) === name) return i;
  }
  return null;
}

// ── What the model reads of a skill ─────────────────────────────────

/** Server text the model reads as data (engine.ts dataText's rule): one line, at most `max`, every "<" and ">" escaped, so it can never close a block. */
function dataText(s: string, max: number): string {
  return clampText(plainData(s).replace(/\s+/g, " ").trim(), max).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A value as the data lines say it: asked each time, or the person's own fixed words. */
function valueTail(v: SkillValue): string {
  return "fixed" in v ? `: "${dataText(v.fixed, L.fixedTextMax)}"` : ": asked each time";
}

/** The person's own title, said beside a step that keeps no words of the page, when it is not the step's words-free title. */
function calledTail(s: SkillStep, first: string): string {
  if (!("name" in s) || s.name) return "";
  return s.title && s.title !== wordsFreeTitle(s) ? `; ${first} calls this step "${dataText(s.title, L.stepTitleMax)}"` : "";
}

/**
 * The skill's steps as block 2 and use_skill give them (step 4): one line a
 * step, numbered, every name, title and value as data, never a picture's id.
 * A step whose words were removed (forgetName) is said by the person's title.
 */
export function skillDataLines(steps: readonly SkillStep[], first: string): string[] {
  const who = dataText(first || "the person", 40);
  return steps.map((s, i) => {
    const n = i + 1;
    const page = dataText(s.page || s.site, PAGE_MAX);
    const nm = "name" in s ? dataText(s.name, L.stepTitleMax) : "";
    switch (s.kind) {
      case "start":
        return `${n}. Start at ${dataText(s.address, ADDRESS_MAX)}`;
      case "link":
        return nm ? `${n}. Go to the link "${nm}" on ${page}` : `${n}. Go to a link on ${page}${calledTail(s, who)}`;
      case "click": {
        const role = roleWords(s.role);
        const asks = s.role === "link" ? " (it asks first)" : "";
        if (nm && ACTION_SET.has(s.name)) return `${n}. Click ${role} with "${nm}" in its words on ${page}${asks}`;
        if (nm) return `${n}. Click ${role} "${nm}" on ${page}${asks}`;
        return `${n}. Click ${role} on ${page}${asks}${calledTail(s, who)}`;
      }
      case "type": {
        const where = nm ? `Type in "${nm}" on ${page}` : `Type in a field on ${page}`;
        return `${n}. ${where}${valueTail(s.value)}${s.pressEnter ? ", then press Enter" : ""}${calledTail(s, who)}`;
      }
      case "choose": {
        if (s.via === "suggestion") {
          const where = nm ? `Choose one of the suggestions in "${nm}" on ${page}` : `Choose one of the suggestions on ${page}`;
          return `${n}. ${where}${valueTail(s.value)}${calledTail(s, who)}`;
        }
        if (s.via === "item") {
          const where = nm ? `Open one item of "${nm}" on ${page}` : `Open one item of the list on ${page}`;
          return `${n}. ${where}${"fixed" in s.value ? valueTail(s.value) : `: ask ${who} which`}${calledTail(s, who)}`;
        }
        const where = nm ? `Choose in "${nm}" on ${page}` : `Choose in a list on ${page}`;
        return `${n}. ${where}${valueTail(s.value)}${s.via === "click" ? ", by clicking the option" : ""}${calledTail(s, who)}`;
      }
      case "yourself":
        return `${n}. ${who} does this themselves on ${page}: ${YOURSELF_WORDS[s.reason]} (use ask_to_take_over)`;
      case "gap":
        return `${n}. A step here may be missing from the recording: follow the page, and ask ${who} if you are not sure`;
    }
  });
}

// ── Reading stored steps ────────────────────────────────────────────

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

function storedValue(v: unknown, kind: "type" | "choose"): SkillValue | null {
  if (!isValue(v)) return null;
  if ("ask" in v) return { ask: true };
  return v.fixed.length <= (kind === "choose" ? L.fixedOptionMax : L.fixedTextMax) && v.fixed.trim() ? { fixed: v.fixed } : null;
}

const KINDS: ReadonlySet<string> = new Set(SKILL_STEP_KINDS);
const VIAS: ReadonlySet<string> = new Set(CHOOSE_VIAS);
const REASONS: ReadonlySet<string> = new Set(YOURSELF_REASONS);
const FIELDS: ReadonlySet<string> = new Set(FIELD_KINDS);
const WARNINGS: ReadonlySet<string> = new Set(CLICK_WARNINGS);

/** One stored step, read defensively (every field its type and size), or null when it is not one. */
function storedStep(raw: unknown): SkillStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && STEP_ID.test(o.id) ? o.id : null;
  const kind = typeof o.kind === "string" && KINDS.has(o.kind) ? o.kind : null;
  const title = str(o.title, L.stepTitleMax);
  const site = str(o.site, HOST_MAX);
  const page = str(o.page, PAGE_MAX);
  if (!id || !kind || title === null || !title.trim() || site === null || page === null) return null;
  if (site && !HOST.test(site)) return null;
  if (!site && kind !== "gap") return null;
  const shotId = typeof o.shotId === "string" && SHOT_ID.test(o.shotId) ? o.shotId : null;
  const base = { id, title, site, page, shotId };
  switch (kind) {
    case "start": {
      const address = str(o.address, ADDRESS_MAX);
      return address && webUrl(address) ? { ...base, kind: "start", address } : null;
    }
    case "link": {
      const name = str(o.name, L.stepTitleMax);
      return name === null ? null : { ...base, kind: "link", name };
    }
    case "click": {
      const name = str(o.name, L.stepTitleMax);
      const role = str(o.role, ROLE_MAX);
      const tag = str(o.tag, ROLE_MAX);
      const type = o.type === null ? null : str(o.type, ROLE_MAX);
      const formHost = o.formHost === null ? null : str(o.formHost, HOST_MAX);
      if (name === null || !role || !tag || (o.type !== null && type === null) || (o.formHost !== null && formHost === null)) return null;
      const warnings = Array.isArray(o.warnings) ? CLICK_WARNINGS.filter((w) => (o.warnings as unknown[]).includes(w)) : [];
      if (Array.isArray(o.warnings) && o.warnings.some((w) => typeof w !== "string" || !WARNINGS.has(w))) return null;
      return { ...base, kind: "click", role, name, tag, type, formHost, warnings };
    }
    case "type": {
      const name = str(o.name, L.stepTitleMax);
      const fieldKind = typeof o.fieldKind === "string" && FIELDS.has(o.fieldKind) ? (o.fieldKind as FieldKind) : null;
      const value = storedValue(o.value, "type");
      if (name === null || !fieldKind || typeof o.pressEnter !== "boolean" || !value) return null;
      return { ...base, kind: "type", name, fieldKind, pressEnter: o.pressEnter, value };
    }
    case "choose": {
      const name = str(o.name, L.stepTitleMax);
      const via = typeof o.via === "string" && VIAS.has(o.via) ? (o.via as ChooseVia) : null;
      const value = storedValue(o.value, "choose");
      if (name === null || !via || !value) return null;
      return { ...base, kind: "choose", via, name, value };
    }
    case "yourself": {
      const reason = typeof o.reason === "string" && REASONS.has(o.reason) ? (o.reason as YourselfReason) : null;
      return reason ? { ...base, kind: "yourself", reason } : null;
    }
    case "gap":
      return { ...base, kind: "gap" };
  }
  return null;
}

/**
 * A skill's stored steps (TeammateSkill.steps), read defensively: a step
 * that is not one (an unknown kind, a field of the wrong type or size) is
 * dropped, and so is a second step with an id already read; at most
 * recordedStepsMax.
 */
export function storedSteps(raw: unknown): SkillStep[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillStep[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, L.recordedStepsMax)) {
    const s = storedStep(r);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
