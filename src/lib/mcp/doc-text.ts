// A doc's text for get_doc (docs/plans/mcp-server.md 4.3, Question 11).
//
// The extractor that exists is src/lib/docs/content-markdown.ts
// docToMarkdown, which the doc export already reads: BlockNote (bnDoc)
// first, then TipTap JSON, then the legacy blocks mirror (content.blocks),
// as Markdown. Only the oldest docs, saved as an HTML string
// (content.html, or a bare string), are left; those are stripped to their
// text. An empty doc is "". Null only for a content no format describes (an
// array, a number), which get_doc answers docFormat.
//
// Pure.

import { docToMarkdown } from "@/lib/docs/content-markdown";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** HTML reduced to its text: scripts and styles dropped, blocks to lines, tags removed, entities read. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key];
      if (key.startsWith("#x")) {
        const n = parseInt(key.slice(2), 16);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      if (key.startsWith("#")) {
        const n = parseInt(key.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The doc's text, or null when its content is in no format we know. */
export function docText(content: unknown): string | null {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return htmlText(content);
  if (typeof content !== "object" || Array.isArray(content)) return null;
  const c = content as Record<string, unknown>;
  const known = Array.isArray(c.bnDoc) || (c.type === "doc" && Array.isArray(c.content)) || Array.isArray(c.blocks);
  if (known) return docToMarkdown("", content).trim();
  if (typeof c.html === "string") return htmlText(c.html);
  return "";
}
