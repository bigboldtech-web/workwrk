// The one sanitizer for HTML a person wrote (SOP steps and rich text, docs in
// the old rich-text format), applied where it is SHOWN, never when it is
// saved: what people type is stored exactly as they typed it (a plain-text
// description such as "Press <Enter>" or "Email HR <hr@acme.com>" would lose
// words to an HTML sanitizer), and every place that puts it into a page runs
// it through here. Works the same on the server, where public share pages
// render, and in the browser.
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
  // The rich editor's task lists (src/components/ui/rich-editor.tsx): a
  // label holding a checkbox. No other kind of input survives (below).
  "label", "input",
];

const WIDTH = [/^\d+(\.\d+)?(px|%|em|rem)$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan", "align", "colwidth"],
    td: ["colspan", "rowspan", "align", "colwidth"],
    col: ["span"],
    ol: ["start", "type"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    mark: ["data-color"],
    "*": ["class", "style"],
  },
  // A checkbox only: any other input (a password field, a hidden one) goes.
  exclusiveFilter: (frame) => frame.tag === "input" && (frame.attribs.type ?? "").toLowerCase() !== "checkbox",
  // Formatting the editors write, and nothing that can load or run anything.
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^(normal|bold|[1-9]00)$/],
      "font-style": [/^(normal|italic)$/],
      "text-decoration": [/^(none|underline|line-through)$/],
      // Table and column widths (the editor's resizable tables).
      width: WIDTH,
      "min-width": WIDTH,
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  // Dropped with everything inside them, never kept as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "template", "iframe", "object", "embed", "svg", "math", "title"],
  transformTags: {
    // A link that opens anywhere but this page never hands the opener over.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target ? { ...attribs, rel: "noopener noreferrer" } : attribs,
    }),
  },
};

/** Only the allowed formatting of a piece of HTML a person wrote. */
export function safeUserHtml(html: unknown): string {
  if (typeof html !== "string" || html === "") return "";
  return sanitizeHtml(html, OPTIONS);
}
