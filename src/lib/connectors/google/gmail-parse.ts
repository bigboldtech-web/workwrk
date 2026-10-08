// What a Gmail message says, as text a teammate's model may read
// (docs/plans/ai-teammates-phase3.md step 3). Pure: it reads the message
// shape Gmail's API answers with (payload, parts, headers, body.data).
//
// WHAT THE PERSON SEES. Of two versions of one message (multipart/
// alternative), the HTML one is read, as Gmail shows it: a sentence put only
// in the plain version would reach the model and never the person (review of
// step 1). A message of several parts (multipart/mixed) is read part by
// part. A message with no HTML is read as its plain text.
//
// HTML is parsed with htmlparser2 (through sanitize-html), which reads tags,
// attributes and comments as a browser does and in time linear in its
// length: an outsider's mail can never stall the server (review of step 1:
// pattern matching took quadratic time on "<a<a<a..."). What a mail client
// never shows (scripts, styles, the head, and any element hidden by its
// inline style or the hidden attribute) goes with everything inside it. That
// is a best effort against text planted out of sight, not a promise: the
// rule that a turn which read mail asks before every write (Decision 9) is
// what keeps a planted sentence from acting.
//
// ATTACHMENTS ARE COUNTED, NEVER NAMED OR OPENED (Decision 10): a part with a
// filename or an attachment id adds one to the count, and nothing of it is
// read or returned.

import sanitizeHtml from "sanitize-html";
import { clampText } from "@/lib/agents/clamp";

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The first value of a header, by name in any case, as Gmail gave it; null when there is none. */
export function headerOf(payload: unknown, name: string): string | null {
  const headers = rec(payload)?.headers;
  if (!Array.isArray(headers)) return null;
  const want = name.toLowerCase();
  for (const h of headers) {
    const r = rec(h);
    if (r && typeof r.name === "string" && r.name.toLowerCase() === want && typeof r.value === "string") return r.value;
  }
  return null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The entities text needs, read in one pass, so "&amp;lt;" stays "&lt;". A code point no text may hold reads as U+FFFD. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (whole: string, e: string) => {
    const k = e.toLowerCase();
    if (k[0] !== "#") return NAMED_ENTITIES[k] ?? whole;
    const code = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
    return String.fromCodePoint(code);
  });
}

/** What a mail client never shows: dropped with everything inside it. */
const NEVER_SHOWN: ReadonlySet<string> = new Set(["script", "style", "head", "title", "template", "svg", "math", "object", "iframe"]);

/** A tag that starts and ends a line of its own as a browser lays it out. */
const LINE_TAGS: ReadonlySet<string> = new Set([
  "address", "article", "aside", "blockquote", "br", "caption", "center", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "tfoot", "thead", "tr", "ul",
]);

/** A table cell: set apart from its neighbours, so "12" and "5" never read as "125" (review of step 1). */
const CELL_TAGS: ReadonlySet<string> = new Set(["td", "th"]);

/** One code point, or U+FFFD for one no text may hold. */
function codePoint(code: number): string {
  return !Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(code);
}

/**
 * An inline style as its declarations would be read: comments out (found by
 * index, so a long style cannot slow this down), CSS escapes read as the
 * characters they name, lower case, no spaces.
 */
function plainCss(style: string): string {
  const s = String(style ?? "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("/*", i);
    if (open < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, open);
    const close = s.indexOf("*/", open + 2);
    if (close < 0) break;
    i = close + 2;
  }
  return out
    .replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^0-9a-fA-F\n])/g, (_m: string, hex: string | undefined, ch: string | undefined) => (hex ? codePoint(parseInt(hex, 16)) : (ch ?? "")))
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** A length's number, "!important" and its unit aside; NaN for none. */
function amount(v: string | undefined): number {
  return v === undefined ? NaN : parseFloat(v.replace("!important", ""));
}

/**
 * Whether an inline style hides what it styles: no display, no visibility,
 * no opacity, no font size (or one too small to read), no room with its
 * overflow hidden, moved far off the page, or scaled or clipped to nothing.
 */
export function hidesContent(style: string): boolean {
  const decl = new Map<string, string>();
  for (const part of plainCss(style).split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) decl.set(part.slice(0, colon), part.slice(colon + 1).replace("!important", ""));
  }
  const is = (prop: string, ...values: string[]) => values.some((v) => (decl.get(prop) ?? "").startsWith(v));
  const zero = (prop: string) => amount(decl.get(prop)) === 0;
  const overflowHidden = ["overflow", "overflow-x", "overflow-y"].some((p) => is(p, "hidden", "clip"));
  const fontSize = decl.get("font-size");
  const tinyFont = fontSize !== undefined && (amount(fontSize) === 0 || (/^[\d.]+(px|pt)?$/.test(fontSize) && amount(fontSize) <= 1));
  const offPage = (is("position", "absolute", "fixed") && (amount(decl.get("left")) <= -100 || amount(decl.get("top")) <= -100)) || amount(decl.get("text-indent")) <= -100;
  return (
    is("display", "none") ||
    is("visibility", "hidden", "collapse") ||
    is("content-visibility", "hidden") ||
    (decl.has("opacity") && amount(decl.get("opacity")) <= 0.01) ||
    tinyFont ||
    ((zero("height") || zero("max-height") || zero("width") || zero("max-width")) && overflowHidden) ||
    offPage ||
    /scale\(0[,)]|scale\(0\.0+[,)]/.test(decl.get("transform") ?? "") ||
    /^(inset\(50%|circle\(0)/.test(decl.get("clip-path") ?? "")
  );
}

/** Whether an element is one a mail client never shows. */
function neverShown(tag: string, attribs: Record<string, string>): boolean {
  return NEVER_SHOWN.has(tag) || Object.prototype.hasOwnProperty.call(attribs, "hidden") || hidesContent(attribs.style ?? "");
}

/** `s` without control marks, but its line ends and tabs. */
function withoutControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if ((c < 0x20 && c !== 0x0a && c !== 0x09) || c === 0x7f) continue;
    out += ch;
  }
  return out;
}

/** Text with its blank runs collapsed: single spaces, no trailing ones, at most one empty line in a row. */
function tidy(s: string): string {
  return withoutControls(s.replace(/\r\n?/g, "\n"))
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * An HTML body as the text a person would read: what is never shown out, with
 * everything inside it; the source's own line breaks as the spaces a browser
 * makes of them; a line for each block and <br>; a gap between table cells;
 * every other tag dropped; entities decoded once; blank runs collapsed.
 */
export function htmlToText(html: string): string {
  // Every tag kept, with no attribute: the filter sees every element, and
  // what comes out is bare tags around escaped text, where each "<" opens a
  // tag, so the pass below stays linear too.
  const bare = sanitizeHtml(String(html ?? ""), {
    allowedTags: false,
    allowedAttributes: {},
    allowVulnerableTags: true,
    exclusiveFilter: (frame) => neverShown(frame.tag, frame.attribs ?? {}),
  });
  const laidOut = bare
    .replace(/\s+/g, " ")
    .replace(/<\/?([a-z][a-z0-9-]*)[^<>]*>/g, (_m: string, name: string) => (LINE_TAGS.has(name) ? "\n" : CELL_TAGS.has(name) ? "\t" : ""));
  return tidy(decodeEntities(laidOut)).replace(/\n+/g, "\n");
}

/** The most HTML one body is read from: the text past it is cut, and says so. */
const HTML_READ_MAX = 500_000;

/** A part's text, decoded from Gmail's base64url in the charset its Content-Type names (UTF-8 when it names none this runtime reads). */
function partText(part: Record<string, unknown>): string {
  const data = String(rec(part.body)?.data ?? "");
  const bytes = Buffer.from(data, "base64url");
  const charset = /charset\s*=\s*"?([^";\s]+)"?/i.exec(headerOf(part, "Content-Type") ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** The most parts one message is read through: deeper or wider than any real message is not read further. */
const PARTS_MAX = 200;

/** Whether a part is an attachment: a filename, or a body kept apart behind an attachment id. */
function isAttachment(part: Record<string, unknown>): boolean {
  const filename = typeof part.filename === "string" ? part.filename.trim() : "";
  const body = rec(part.body);
  return Boolean(filename) || (typeof body?.attachmentId === "string" && body.attachmentId.length > 0);
}

function mimeOf(part: Record<string, unknown>): string {
  return typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
}

/** Whether a part is, or holds below it, an HTML body (not an attachment). */
function holdsHtml(p: unknown, depth: number): boolean {
  const part = rec(p);
  if (!part || depth > 30 || isAttachment(part)) return false;
  if (mimeOf(part) === "text/html") return true;
  return Array.isArray(part.parts) && part.parts.some((c) => holdsHtml(c, depth + 1));
}

/**
 * A message's text, at most `max` characters, read as the person sees it:
 * of two versions (multipart/alternative) the HTML one when there is one,
 * else the plain one; every part of a message of several parts, in order. `cut`
 * when the text was longer; `attachments` counts the parts with a filename
 * or an attachment id, which are never read and never named.
 */
export function bodyText(payload: unknown, max: number): { text: string; cut: boolean; format: "plain" | "html" | "none"; attachments: number } {
  const texts: string[] = [];
  let attachments = 0;
  let sawHtml = false;
  let sawPlain = false;
  let cut = false;
  let seen = 0;
  // Every attachment counts, in whichever version it sits.
  const count = (p: unknown, depth: number): void => {
    const part = rec(p);
    if (!part || depth > 30 || (seen += 1) > PARTS_MAX) return;
    if (isAttachment(part)) attachments += 1;
    else if (Array.isArray(part.parts)) for (const c of part.parts) count(c, depth + 1);
  };
  count(payload, 0);
  seen = 0;
  const read = (p: unknown, depth: number): void => {
    const part = rec(p);
    if (!part || depth > 30 || (seen += 1) > PARTS_MAX || isAttachment(part)) return;
    const type = mimeOf(part);
    if (type.startsWith("multipart/")) {
      const kids: unknown[] = Array.isArray(part.parts) ? part.parts : [];
      if (type === "multipart/alternative") {
        // The last version is the richest (RFC 2046); an HTML one when there is one.
        const pick = [...kids].reverse().find((k) => holdsHtml(k, depth + 1)) ?? [...kids].reverse().find((k) => Boolean(rec(k)));
        if (pick) read(pick, depth + 1);
        return;
      }
      for (const k of kids) read(k, depth + 1);
      return;
    }
    const body = rec(part.body);
    if (typeof body?.data !== "string" || body.data.length === 0) return;
    if (type === "text/html") {
      const html = partText(part);
      if (html.length > HTML_READ_MAX) cut = true;
      const text = htmlToText(html.length > HTML_READ_MAX ? html.slice(0, HTML_READ_MAX) : html);
      if (text) texts.push(text);
      sawHtml = true;
    } else if (type === "text/plain") {
      const text = tidy(partText(part));
      if (text) texts.push(text);
      sawPlain = true;
    }
  };
  read(payload, 0);

  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  let text = texts.join("\n\n");
  if (text.length > limit) {
    text = clampText(text, limit).trimEnd();
    cut = true;
  }
  return { text, cut, format: sawHtml ? "html" : sawPlain ? "plain" : "none", attachments };
}
