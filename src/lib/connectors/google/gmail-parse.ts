// What a Gmail message says, as text a teammate's model may read
// (docs/plans/ai-teammates-phase3.md step 3). Pure: it reads the message
// shape Gmail's API answers with (payload, parts, headers, body.data).
//
// PLAIN TEXT FIRST. A message's text/plain part is read over its text/html
// one, depth first through its multipart parts. HTML is read as the person
// would see it, best effort: what a mail client never shows (scripts,
// styles, the head, comments, and any element hidden by its inline style or
// the hidden attribute) is dropped, so a sentence planted out of the
// person's sight is not one the model reads either.
//
// ATTACHMENTS ARE COUNTED, NEVER NAMED OR OPENED (Decision 10): a part with a
// filename or an attachment id adds one to the count, and nothing of it is
// read or returned.

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

/** The elements that never hold content of their own. */
const VOID_TAGS: ReadonlySet<string> = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** A tag's attributes, by lower-case name; a bare attribute reads as "". */
function attributesOf(attrs: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of attrs.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Whether an inline style hides what it styles: display none, visibility hidden, a zero font size or opacity, or no height to overflow. */
function hidesContent(style: string): boolean {
  const s = decodeEntities(style).toLowerCase().replace(/\s+/g, "");
  const zero = (prop: string) => new RegExp(`(?:^|;)${prop}:0(?:\\.0+)?[a-z%]*(?:!important)?(?:;|$)`).test(s);
  return (
    s.includes("display:none") ||
    s.includes("visibility:hidden") ||
    zero("font-size") ||
    zero("opacity") ||
    (zero("max-height") && s.includes("overflow:hidden"))
  );
}

function isHiddenTag(attrs: string): boolean {
  const a = attributesOf(attrs);
  return a.has("hidden") || hidesContent(a.get("style") ?? "");
}

/** Where the element opened before `from` closes: past its matching close tag, counting nested ones of its name; the end when it never closes. */
function closeOf(html: string, name: string, from: number): number {
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else if (!m[0].endsWith("/>")) depth += 1;
  }
  // An element hidden and never closed hides the rest of the page in a browser too.
  return html.length;
}

/** The html without the elements its inline styles hide, their content included. */
function dropHidden(html: string): string {
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let out = "";
  let kept = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    if (!isHiddenTag(m[2])) continue;
    out += html.slice(kept, m.index);
    const name = m[1].toLowerCase();
    kept = VOID_TAGS.has(name) || m[2].trim().endsWith("/") ? m.index + m[0].length : closeOf(html, name, m.index + m[0].length);
    open.lastIndex = kept;
  }
  return out + html.slice(kept);
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
 * An HTML body as the text a person would read (best effort, by pattern):
 * scripts, styles, the head, comments and hidden elements out; a line break
 * for each <br> and each closed paragraph, block or list item; the other
 * tags stripped; the common entities and numeric ones decoded; blank runs
 * collapsed.
 */
export function htmlToText(html: string): string {
  let s = String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = dropHidden(s)
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, "\n")
    .replace(/<\/?[a-zA-Z!][^>]*>/g, "");
  return tidy(decodeEntities(s));
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

/**
 * A message's text, at most `max` characters: its first text/plain part,
 * else its first text/html part read as text, searched depth first. `cut`
 * when the text was longer; `attachments` counts the parts with a filename
 * or an attachment id, which are never read and never named.
 */
export function bodyText(payload: unknown, max: number): { text: string; cut: boolean; format: "plain" | "html" | "none"; attachments: number } {
  const found: { plain: Record<string, unknown> | null; html: Record<string, unknown> | null; attachments: number } = { plain: null, html: null, attachments: 0 };
  const walk = (p: unknown, depth: number): void => {
    const part = rec(p);
    // Deeper than any real message nests: read no further.
    if (!part || depth > 30) return;
    const body = rec(part.body);
    const filename = typeof part.filename === "string" ? part.filename.trim() : "";
    if (filename || (typeof body?.attachmentId === "string" && body.attachmentId)) {
      found.attachments += 1;
      return;
    }
    const type = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
    const hasData = typeof body?.data === "string" && body.data.length > 0;
    if (hasData && type === "text/plain" && !found.plain) found.plain = part;
    else if (hasData && type === "text/html" && !found.html) found.html = part;
    if (Array.isArray(part.parts)) for (const child of part.parts) walk(child, depth + 1);
  };
  walk(payload, 0);

  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  let text = "";
  let format: "plain" | "html" | "none" = "none";
  let cut = false;
  if (found.plain) {
    text = tidy(partText(found.plain));
    format = "plain";
  } else if (found.html) {
    const html = partText(found.html);
    cut = html.length > HTML_READ_MAX;
    text = htmlToText(cut ? html.slice(0, HTML_READ_MAX) : html);
    format = "html";
  }
  if (text.length > limit) {
    text = clampText(text, limit).trimEnd();
    cut = true;
  }
  return { text, cut, format, attachments: found.attachments };
}
