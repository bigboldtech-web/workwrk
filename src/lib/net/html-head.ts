// The title and meta tags of a page's <head>, in ONE linear pass.
//
// Pen test 2026-11-28 (V-10): the link preview ran about twelve regexes of
// the form <meta[^>]+property=...[^>]+content=... over up to 256 KB of a page.
// A page of repeated "<meta " with no ">" made each [^>]+ run to the end and
// backtrack: the time grew with the square of the page, on the main thread,
// so one crafted link froze the server for every company (16 KB already took
// a second). This scanner looks at each tag once: it finds "<meta", reads to
// the next ">" (a tag longer than MAX_TAG is skipped, never re-scanned), and
// reads its attributes from that short slice, one character at a time.

const MAX_TAG = 4096;

/** ASCII lower case, same length (toLowerCase can change a string's length). */
function lowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/**
 * A tag's attributes, read left to right: every step moves forward, so the
 * time is the tag's length (no regex, no backtracking).
 */
export function attributesOf(tag: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const n = tag.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSpace(tag[i]) || tag[i] === "/")) i++;
    const start = i;
    while (i < n && !isSpace(tag[i]) && tag[i] !== "=" && tag[i] !== "/" && tag[i] !== ">") i++;
    const name = tag.slice(start, i);
    if (!name) { i++; continue; }
    while (i < n && isSpace(tag[i])) i++;
    if (tag[i] !== "=") { out.push([name, ""]); continue; }
    i++;
    while (i < n && isSpace(tag[i])) i++;
    const q = tag[i];
    if (q === '"' || q === "'") {
      const close = tag.indexOf(q, i + 1);
      const stop = close === -1 ? n : close;
      out.push([name, tag.slice(i + 1, stop)]);
      i = stop + 1;
    } else {
      const vs = i;
      while (i < n && !isSpace(tag[i])) i++;
      out.push([name, tag.slice(vs, i)]);
    }
  }
  return out;
}

export interface HeadMeta {
  title: string | null;
  /** meta property=... and name=... (lower-cased key) to content, the first one of each. */
  meta: Map<string, string>;
}

export function parseHeadMeta(html: string): HeadMeta {
  const lower = lowerAscii(html);
  const headEnd = lower.indexOf("</head>");
  const end = headEnd === -1 ? html.length : headEnd;
  const meta = new Map<string, string>();

  let pos = 0;
  let nextGt = -1;
  while (pos < end) {
    const at = lower.indexOf("<meta", pos);
    if (at === -1 || at >= end) break;
    // The next ">" is found once and reused until a tag starts past it, so
    // the whole scan reads the page a fixed number of times.
    if (nextGt < at) nextGt = lower.indexOf(">", at);
    if (nextGt === -1) break;
    if (nextGt - at > MAX_TAG) { pos = at + 5; continue; }
    const tag = html.slice(at + 5, nextGt);
    pos = nextGt + 1;
    let key: string | null = null;
    let content: string | null = null;
    for (const [rawName, value] of attributesOf(tag)) {
      const name = lowerAscii(rawName);
      if ((name === "property" || name === "name") && key === null) key = lowerAscii(value.trim());
      else if (name === "content" && content === null) content = value;
    }
    if (key && content !== null && !meta.has(key)) meta.set(key, decodeEntities(content.trim()));
  }

  let title: string | null = null;
  const t = lower.indexOf("<title");
  if (t !== -1 && t < end) {
    const open = lower.indexOf(">", t);
    const close = open === -1 ? -1 : lower.indexOf("</title", open);
    if (open !== -1 && close !== -1 && open - t <= MAX_TAG) {
      const text = decodeEntities(html.slice(open + 1, close).trim());
      title = text || null;
    }
  }
  return { title, meta };
}
