// What the model reads of a page (docs/plans/ai-teammates-phase4.md
// Decision 17): the page reader's raw snapshot (step 2, read in an isolated
// world the page's scripts cannot touch) shaped into a PageView, which the
// executor wraps in <tool_data> like every tool result (executor.ts
// wrapToolData escapes it there; nothing here escapes).
//
// WHAT IT KEEPS, AND HOW MUCH:
//   - the text a person sees, joined, made plain (plain-data.ts plainData:
//     look-alike brackets and invisible characters), with card numbers,
//     codes and IBANs hidden (redact.ts), cut into parts of 8,000
//     characters, never inside a word when a space is near, at most 10;
//   - the main frame's buttons, fields and lists, at most 120, each with an
//     id e1, e2 and on in document order, its role, its name (clipped), its
//     kind, whether a field holds something (never what), and a list's
//     options (at most 30, clipped);
//   - absolute http(s) links, fragment dropped, each once, at most 80; a
//     link longer than 500 characters is left out, never cut, since a cut
//     address is one the page never showed.
//
// NO FIELD VALUE CAN REACH THE MODEL. Every object here is built field by
// field from named keys, so a raw `value`, or any key the reader did not
// mean to send, is never copied.
//
// NO CODE OR SIGN-IN TOKEN IN AN ADDRESS (review of Phase 4 step 1). A
// page's links and its own address carry what a page put there: a one-time
// code in a "?code=", a sign-in or reset token in "?token=". The redaction
// runs over each link's decoded address and over the page's; a link that
// would have anything hidden, or whose query has a sensitive key
// (SENSITIVE_KEYS: code, token, reset, session and the rest, by key, case
// aside), is left out whole and counted in the note, and the page's
// address is shown as its origin and path only.
//
// WHITESPACE FIRST, THEN THE REDACTION (review of Phase 4 step 1): names,
// options, link words and the title are made one line before redact.ts
// reads them, so a card number or a code spaced out over a name is found.
//
// ONE READ FITS ONE RESULT (review of Phase 4 step 1). The view's JSON is
// held under VIEW_JSON_BUDGET, below executor.ts TOOL_DATA_MAX, past which
// wrapToolData cuts a result mid-JSON and the model reads half a page: the
// lists' options are capped together, then trimmed, then the last elements,
// then the last links, until it fits, and the note says what was left out.
// Only the links that made it into the view are returned for open_page
// (Decision 11), so the model can follow nothing it was not shown.
//
// Pure.

import { plainData } from "@/lib/agents/plain-data";
import { clampText } from "@/lib/agents/clamp";
import { BROWSER_COPY } from "@/lib/agents/teammate-copy";
import { PAGE_LIMITS } from "./classes";
import { redactPageText } from "./redact";
import { FIELD_KINDS, type ElementFingerprint, type FieldKind, type RawSnapshot } from "./types";

/**
 * The most a page view's JSON may be: under executor.ts TOOL_DATA_MAX
 * (30,000 characters), past which wrapToolData cuts a result mid-JSON. Not
 * imported from there, since this module is pure and the executor is
 * server-side; executor.test.ts holds the two numbers together.
 */
export const VIEW_JSON_BUDGET = 24_000;

/** The most characters every list's options may hold together: the lists past it, last first, lose theirs. */
export const OPTION_CHARS_TOTAL = 4_000;

/**
 * Query keys that carry a code, a token, a key or a session: a link with
 * one is left out, and a page address with one is shown as origin and path
 * (review of Phase 4 step 1). Matched against the whole key and against
 * its last part ("reset_token", "x-sig"), case aside.
 */
export const SENSITIVE_KEYS: readonly string[] = [
  "code",
  "otp",
  "token",
  "ticket",
  "reset",
  "key",
  "password",
  "pass",
  "pwd",
  "auth",
  "session",
  "sid",
  "sig",
  "signature",
  "secret",
  "nonce",
  "state",
  "jwt",
  "access_token",
  "id_token",
];

const SENSITIVE_KEY_SET: ReadonlySet<string> = new Set(SENSITIVE_KEYS);

export interface PageViewElement {
  id: string;
  role: string;
  name: string;
  kind: FieldKind;
  filled?: true;
  disabled?: true;
  options?: string[];
}

export interface PageViewLink {
  id: string;
  text: string;
  href: string;
}

export interface PageView {
  site: string;
  url: string;
  title: string;
  /** Which part of the text this is, 1 on, and how many there are. */
  part: number;
  parts: number;
  text: string;
  /** More text follows this part, or the page had more than the parts hold. */
  cut: boolean;
  elements: PageViewElement[];
  links: PageViewLink[];
  /** How many card numbers, codes and IBANs were hidden. */
  hidden: number;
  note: string;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<string>(FIELD_KINDS);

/** A kind the reader named, as one this code knows; anything else is no field. */
function kindOf(k: unknown): FieldKind {
  return typeof k === "string" && KNOWN_KINDS.has(k) ? (k as FieldKind) : "none";
}

/** How far back from a part's end a cut looks for a space. */
const WORD_BACK = 200;

/** Text made plain, made one line, then redacted, with what was hidden added to the count. */
function clean(s: unknown, max: number, count: { hidden: number }): string {
  const flat = plainData(typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
  const r = redactPageText(flat);
  count.hidden += r.hidden;
  return clampText(r.text, max);
}

/**
 * The text in parts of at most `size`: each cut at the last space within
 * WORD_BACK of its end when there is one, never between the two halves of
 * a character, and at most `max` parts. `beyond` when text was left over.
 */
function cutParts(text: string, size: number, max: number): { parts: string[]; beyond: boolean } {
  const parts: string[] = [];
  let at = 0;
  while (at < text.length && parts.length < max) {
    let end = Math.min(at + size, text.length);
    if (end < text.length) {
      const from = Math.max(at + 1, end - WORD_BACK);
      const window = text.slice(from, end + 1);
      const space = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"), window.lastIndexOf("\t"));
      if (space >= 0 && from + space > at && from + space <= end) end = from + space;
      // Never between a high and a low surrogate.
      if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "") && end - 1 > at) end -= 1;
    }
    parts.push(text.slice(at, end));
    at = end;
    while (at < text.length && /\s/.test(text[at])) at += 1;
  }
  if (parts.length === 0) parts.push("");
  return { parts, beyond: at < text.length };
}

/** An absolute http(s) address with no user name or password, its fragment dropped, or null. */
function httpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  u.hash = "";
  return u;
}

/** The address with its escapes decoded, as the page meant it; the raw text when they are not valid. */
function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Whether a query key names a code, a token, a key or a session. */
function sensitiveKey(key: string): boolean {
  const lower = key.trim().toLowerCase();
  if (SENSITIVE_KEY_SET.has(lower)) return true;
  const last = lower.split(/[_.-]/).pop() ?? "";
  return SENSITIVE_KEY_SET.has(last);
}

/**
 * Whether an address carries something the redaction would hide, or a
 * sensitive query key. Read as the page meant it: escapes decoded, and a
 * "+" as the space a form writes it for, so "4242+4242+4242+4242" is a card
 * number here too.
 */
function carriesSecret(u: URL): boolean {
  if (redactPageText(decoded(u.href.replace(/\+/g, " "))).hidden > 0) return true;
  for (const key of u.searchParams.keys()) if (sensitiveKey(key)) return true;
  return false;
}

/** A link's address as the model may be shown it: null when it is no link, or carries a secret. */
function linkHref(raw: unknown): { href: string } | { secret: true } | null {
  const u = httpUrl(raw);
  if (!u) return null;
  if (carriesSecret(u)) return { secret: true };
  return { href: u.href };
}

/**
 * The page's own address: whole when it carries no secret, else its origin
 * and path only (the path redacted too, so a code in it is hidden).
 */
function pageAddress(raw: unknown, count: { hidden: number }): string {
  const u = httpUrl(raw);
  if (!u) return "";
  if (!carriesSecret(u)) return clampText(u.href, PAGE_LIMITS.hrefChars);
  const path = redactPageText(decoded(u.pathname));
  count.hidden += path.hidden;
  return clampText(`${u.origin}${path.text}`, PAGE_LIMITS.hrefChars);
}

/** How many characters a list's options hold. */
function optionChars(el: PageViewElement): number {
  return (el.options ?? []).reduce((n, o) => n + o.length, 0);
}

/**
 * The page as the model reads it, the ids it may act on (`refs`: id to the
 * fingerprint the act finds the element again by, kept on the server), and
 * every link it was shown (`links`: what open_page may follow after a read,
 * Decision 11), exactly the links in the view.
 */
export function shapeSnapshot(raw: RawSnapshot, o: { part: number; site: string; note: string }): { view: PageView; refs: Map<string, ElementFingerprint>; links: string[] } {
  const count = { hidden: 0 };

  const joined = Array.isArray(raw.blocks) ? raw.blocks.filter((b): b is string => typeof b === "string").join("\n") : "";
  const redacted = redactPageText(plainData(joined));
  count.hidden += redacted.hidden;
  const { parts, beyond } = cutParts(redacted.text, PAGE_LIMITS.partChars, PAGE_LIMITS.parts);
  const wanted = Number.isInteger(o.part) ? o.part : 1;
  const part = Math.min(Math.max(1, wanted), parts.length);
  const cut = part < parts.length || beyond;

  const refs = new Map<string, ElementFingerprint>();
  const elements: PageViewElement[] = [];
  const mainFrame = (Array.isArray(raw.elements) ? raw.elements : []).filter((e) => e && e.inMainFrame === true);
  for (const e of mainFrame.slice(0, PAGE_LIMITS.elements)) {
    const id = `e${elements.length + 1}`;
    const el: PageViewElement = {
      id,
      role: clean(e.role, 40, count),
      name: clean(e.name, PAGE_LIMITS.nameChars, count),
      kind: kindOf(e.kind),
    };
    if (e.filled === true) el.filled = true;
    if (e.disabled === true) el.disabled = true;
    if (Array.isArray(e.options)) {
      el.options = e.options.slice(0, PAGE_LIMITS.options).map((opt) => clean(opt, PAGE_LIMITS.optionChars, count));
    }
    elements.push(el);
    refs.set(id, {
      tag: typeof e.tag === "string" ? e.tag : "",
      role: typeof e.role === "string" ? e.role : "",
      name: typeof e.name === "string" ? e.name : "",
      kind: kindOf(e.kind),
      type: typeof e.type === "string" ? e.type : null,
      formHost: typeof e.formHost === "string" ? e.formHost : null,
      href: typeof e.href === "string" ? e.href : null,
      twin: Number.isInteger(e.twin) ? e.twin : 0,
    });
  }

  const seen = new Set<string>();
  const links: PageViewLink[] = [];
  let secretLinks = 0;
  let moreLinks = false;
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    const read = linkHref(l?.href);
    if (!read) continue;
    if ("secret" in read) {
      secretLinks += 1;
      continue;
    }
    if (read.href.length > PAGE_LIMITS.hrefChars || seen.has(read.href)) continue;
    seen.add(read.href);
    if (links.length >= PAGE_LIMITS.links) {
      moreLinks = true;
      continue;
    }
    links.push({ id: `l${links.length + 1}`, text: clean(l.text, PAGE_LIMITS.linkTextChars, count), href: read.href });
  }

  // The lists' options together, capped first: the last lists lose theirs.
  let optionsLeftOut = 0;
  let totalOptionChars = elements.reduce((n, el) => n + optionChars(el), 0);
  for (let i = elements.length - 1; i >= 0 && totalOptionChars > OPTION_CHARS_TOTAL; i -= 1) {
    if (!elements[i].options) continue;
    totalOptionChars -= optionChars(elements[i]);
    delete elements[i].options;
    optionsLeftOut += 1;
  }

  const view: PageView = {
    site: o.site,
    url: pageAddress(raw.url, count),
    title: clean(raw.title, PAGE_LIMITS.titleChars, count),
    part,
    parts: parts.length,
    text: parts[part - 1],
    cut,
    elements,
    links,
    hidden: count.hidden,
    note: "",
  };
  const noteOf = (): string => {
    const notes = [o.note];
    if (beyond) notes.push(BROWSER_COPY.textBeyond(PAGE_LIMITS.parts));
    if (optionsLeftOut > 0) notes.push(BROWSER_COPY.optionsLeftOut(optionsLeftOut));
    if (elements.length < mainFrame.length) notes.push(BROWSER_COPY.moreElements(elements.length));
    if (secretLinks > 0) notes.push(BROWSER_COPY.linksLeftOut(secretLinks));
    if (moreLinks) notes.push(BROWSER_COPY.moreLinks(links.length));
    return notes.filter(Boolean).join(" ");
  };

  // Then the whole view under its budget: options, then elements, then links, last first.
  for (;;) {
    view.note = noteOf();
    if (JSON.stringify(view).length <= VIEW_JSON_BUDGET) break;
    let withOptions = -1;
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      if (elements[i].options) {
        withOptions = i;
        break;
      }
    }
    if (withOptions >= 0) {
      delete elements[withOptions].options;
      optionsLeftOut += 1;
    } else if (elements.length > 0) {
      const dropped = elements.pop();
      if (dropped) refs.delete(dropped.id);
    } else if (links.length > 0) {
      links.pop();
      moreLinks = true;
    } else {
      break;
    }
  }
  return { view, refs, links: links.map((l) => l.href) };
}
