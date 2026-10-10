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
// Pure.

import { plainData } from "@/lib/agents/plain-data";
import { clampText } from "@/lib/agents/clamp";
import { BROWSER_COPY } from "@/lib/agents/teammate-copy";
import { PAGE_LIMITS } from "./classes";
import { redactPageText } from "./redact";
import { FIELD_KINDS, type ElementFingerprint, type FieldKind, type RawSnapshot } from "./types";

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

/** Text made plain and redacted, with what was hidden added to the count. */
function clean(s: unknown, max: number, count: { hidden: number }): string {
  const r = redactPageText(plainData(typeof s === "string" ? s : ""));
  count.hidden += r.hidden;
  return clampText(r.text.replace(/\s+/g, " ").trim(), max);
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

/** An absolute http(s) address with its fragment dropped, or null. */
function linkHref(raw: unknown): string | null {
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
  return u.href;
}

/**
 * The page as the model reads it, the ids it may act on (`refs`: id to the
 * fingerprint the act finds the element again by, kept on the server), and
 * every link it was shown (`links`: what open_page may follow after a read,
 * Decision 11).
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
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    if (links.length >= PAGE_LIMITS.links) break;
    const href = linkHref(l?.href);
    if (!href || href.length > PAGE_LIMITS.hrefChars || seen.has(href)) continue;
    seen.add(href);
    links.push({ id: `l${links.length + 1}`, text: clean(l.text, PAGE_LIMITS.linkTextChars, count), href });
  }
  const moreLinks = (Array.isArray(raw.links) ? raw.links : []).some((l) => {
    const href = linkHref(l?.href);
    return href !== null && href.length <= PAGE_LIMITS.hrefChars && !seen.has(href);
  });

  const notes = [o.note];
  if (beyond) notes.push(BROWSER_COPY.textBeyond(PAGE_LIMITS.parts));
  if (mainFrame.length > PAGE_LIMITS.elements) notes.push(BROWSER_COPY.moreElements(PAGE_LIMITS.elements));
  if (moreLinks) notes.push(BROWSER_COPY.moreLinks(PAGE_LIMITS.links));

  const view: PageView = {
    site: o.site,
    url: clampText(linkHref(raw.url) ?? "", PAGE_LIMITS.hrefChars),
    title: clean(raw.title, PAGE_LIMITS.titleChars, count),
    part,
    parts: parts.length,
    text: parts[part - 1],
    cut,
    elements,
    links,
    hidden: count.hidden,
    note: notes.filter(Boolean).join(" "),
  };
  return { view, refs, links: links.map((l) => l.href) };
}
