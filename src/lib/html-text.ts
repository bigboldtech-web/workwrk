// Stored text that may be HTML (an older task description or comment was
// TipTap HTML; today's are Markdown, src/lib/markdown-lite.ts, which passes
// through unchanged) as plain text that keeps its shape: paragraphs apart,
// list items as bullets or numbers, a link as its words then its address,
// entities decoded.
//
// WHY PLAIN TEXT. The public task page is opened by anyone with the link,
// on the app's own domain, where a signed-in visitor's session lives. Any
// HTML passed through a denylist (src/components/sops/sop-read-view.tsx
// safeHtml) is one missed pattern away from running there. Text cannot run:
// React escapes it, so the page is safe by construction. SOP steps exported
// as Markdown read their rich text through it too.
//
// Pure: a small tag scanner, no DOM, so it runs on the server and in tests.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) {
      const n = parseInt(k.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    if (k.startsWith("#")) {
      const n = parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "header", "footer", "table", "tr"]);

/** The address of a link worth printing: http(s) or mailto only. */
function linkTarget(tag: string): string | null {
  const m = /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const raw = decode((m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim());
  return /^(https?:|mailto:)/i.test(raw) ? raw : null;
}

export function htmlToText(html: unknown): string {
  if (typeof html !== "string" || !html) return "";
  // Plain text that was never HTML keeps its own line breaks.
  if (!/<[a-z!/][^>]*>/i.test(html)) return decode(html).trim();
  const out: string[] = [];
  let line = "";
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let pendingLink: string | null = null;
  let linkText = "";
  let skip = 0;
  const flush = () => {
    // The indent of a nested list item stays; the rest is collapsed.
    const lead = /^ */.exec(line)?.[0] ?? "";
    const t = line.slice(lead.length).replace(/[ \t]+/g, " ").trim();
    if (t) out.push(lead + t);
    line = "";
  };
  const gap = () => {
    flush();
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };
  const re = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [whole, tagName, text] = m;
    if (text !== undefined) {
      if (skip > 0) continue;
      const t = decode(text);
      if (pendingLink !== null) linkText += t;
      else line += t;
      continue;
    }
    if (!tagName) continue;
    const name = tagName.toLowerCase();
    const closing = whole.startsWith("</");
    if (name === "script" || name === "style") {
      skip = Math.max(0, skip + (closing ? -1 : whole.endsWith("/>") ? 0 : 1));
      continue;
    }
    if (skip > 0) continue;
    if (name === "br") {
      if (pendingLink !== null) linkText += " ";
      else flush();
      continue;
    }
    if (name === "a") {
      if (!closing) {
        pendingLink = linkTarget(whole) ?? "";
        linkText = "";
      } else if (pendingLink !== null) {
        const words = linkText.replace(/\s+/g, " ").trim();
        line += pendingLink && words && words !== pendingLink ? `${words} (${pendingLink})` : words || pendingLink;
        pendingLink = null;
        linkText = "";
      }
      continue;
    }
    if (name === "ul" || name === "ol") {
      if (!closing) {
        flush();
        lists.push({ ordered: name === "ol", n: 0 });
      } else {
        flush();
        lists.pop();
        if (lists.length === 0) gap();
      }
      continue;
    }
    if (name === "li") {
      flush();
      if (!closing) {
        const l = lists[lists.length - 1];
        const depth = Math.max(0, lists.length - 1);
        if (l) l.n += 1;
        line = `${"  ".repeat(depth)}${l?.ordered ? `${l.n}.` : "•"} `;
      }
      continue;
    }
    if (name === "td" || name === "th") {
      if (closing) line += "  ";
      continue;
    }
    // Inside a list item a paragraph is part of the item's line; the item's
    // own tags start and end it.
    if (BLOCK.has(name) && lists.length === 0) gap();
  }
  if (pendingLink !== null) line += linkText;
  flush();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Was this stored as HTML? An older description or comment (TipTap) always
 * opens with a block tag; today's are Markdown, which may mention a tag
 * ("use the <div> element", "<lea@acme.com>") anywhere but never opens with
 * one of these.
 */
export function looksLikeStoredHtml(text: string): boolean {
  return /^\s*<(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|br)\b[^>]*>/i.test(text);
}

/**
 * Stored text for a page that renders Markdown safely (MarkdownLite: every
 * node a React element): Markdown exactly as written, an older HTML body
 * reduced to plain text, anything else empty.
 */
export function markdownOrText(value: unknown): string {
  if (typeof value !== "string") return "";
  return looksLikeStoredHtml(value) ? htmlToText(value) : value.trim();
}
