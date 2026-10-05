// The one sanitizer for HTML a person wrote (SOP steps and rich text, docs in
// the old rich-text format). Works the same on the server, where public share
// pages render, and in the browser.
//
// WHY. SOP content and old-format docs are stored as the HTML the client sent,
// and were put into the page through a regex blocklist (or none): an
// attribute written <img/onerror=...> or <svg/onload=...> passed it. Anyone
// can sign up, turn public links on in their own workspace and send a SOP's
// public link, so a script in it ran on the app's own origin for every
// visitor, signed in to their own company. This is an ALLOWLIST: only the
// tags and attributes below survive, URLs only with the schemes below, and
// every event handler, script, style block, frame, object, form, SVG and
// MathML element is dropped.

import sanitizeHtml from "sanitize-html";

const TAGS = [
  "p", "br", "hr", "div", "span",
  "strong", "b", "em", "i", "u", "s", "strike", "del", "ins", "mark", "sub", "sup", "small",
  "code", "pre", "kbd", "blockquote",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "figure", "figcaption",
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan", "align"],
    td: ["colspan", "rowspan", "align"],
    ol: ["start", "type"],
    "*": ["class", "style"],
  },
  // Formatting the editors write, and nothing that can load or run anything.
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^(normal|bold|[1-9]00)$/],
      "font-style": [/^(normal|italic)$/],
      "text-decoration": [/^(none|underline|line-through)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  // Dropped with everything inside them, never kept as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "template", "iframe", "object", "embed", "svg", "math", "title"],
  transformTags: {
    // A link that opens a new tab never hands the opener to the page it opens.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : attribs,
    }),
  },
};

/** Only the allowed formatting of a piece of HTML a person wrote. */
export function safeUserHtml(html: unknown): string {
  if (typeof html !== "string" || html === "") return "";
  return sanitizeHtml(html, OPTIONS);
}

/** What the renderers treat as HTML rather than text: any tag. */
const LOOKS_LIKE_HTML = /<[a-z!/][^>]*>/i;

/**
 * A copy of stored content (an SOP's, or a doc in the old rich-text format)
 * with every "html" or "description" string that holds a tag sanitized, at
 * any depth: the rich-text body, steps, checklist sections, flows and
 * recorded steps alike. Plain text is left exactly as typed (it renders as
 * text). Applied when content is saved; the renderers sanitize again, which
 * covers rows saved before this.
 */
export function safeStoredContent<T>(content: T): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return (key === "html" || key === "description") && LOOKS_LIKE_HTML.test(v) ? safeUserHtml(v) : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(content) as T;
}
