// The small markdown a task description and a comment may contain, parsed.
//
// spec-task-detail.md section 2 item 4: "a light editor: paragraphs, bold,
// italic, bullet and numbered lists, links (auto-linked URLs), @mentions,
// stored as a markdown string in Item.metadata.description (existing
// plain-text values render unchanged)".
//
// That last clause is the constraint that shapes this file: every description
// written before Phase 2 is plain text, and plain text has to come out the
// other side looking like itself. So this parser adds meaning and never takes
// any away — an asterisk that is not part of a pair is an asterisk, a line
// that is not a list item is a paragraph, and a stray "_" in a file name is
// not italics.
//
// It is NOT a markdown implementation. There are no headings, no code fences,
// no tables, no images, no block quotes and no HTML, because a task
// description that needs those is a Doc. Anything unrecognised is text.
//
// Pure module: no imports, so vitest loads it in the node environment and a
// client component can render from it without shipping a parser library.

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "link"; href: string; label: string }
  | { type: "mention"; label: string };

export type BlockNode =
  | { type: "paragraph"; content: InlineNode[] }
  | { type: "bullets"; items: InlineNode[][] }
  | { type: "numbers"; items: InlineNode[][]; start: number };

/** Only http(s) and mailto survive; everything else renders as plain text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:[^\s]+@[^\s]+$/i.test(href)) return href;
  if (/^www\./i.test(href)) return `https://${href}`;
  return null;
}

// Ordered by precedence. Each alternative is its own capture group so the
// split below can tell which one matched without re-testing.
const INLINE_RE = new RegExp(
  [
    // [label](href)
    "(\\[[^\\]\\n]+\\]\\((?:[^\\s)]+)\\))",
    // **bold**
    "(\\*\\*[^*\\n]+\\*\\*)",
    // *italic* or _italic_ — a single marker, not touching a word character.
    //
    // The asterisk alternative is guarded the same way the underscore one is,
    // and for the same reason: an unguarded `\*[^*\n]+\*` ate BOTH characters
    // out of "5 * 3 * 2" and italicised the number between them, which is the
    // opposite of this file's contract ("an asterisk that is not part of a
    // pair is an asterisk", and "existing plain-text values render
    // unchanged"). The guard is the ordinary markdown one: a marker may not be
    // followed, or preceded, by whitespace. So "*word*" is italics, "5 * 3 * 2"
    // is arithmetic, "*.ts and *.js" is two globs, and "the * wildcard * here"
    // keeps both its wildcards.
    "(\\*(?![\\s*])(?:[^*\\n]*[^\\s*])?\\*|(?<![\\w])_[^_\\n]+_(?![\\w]))",
    // bare URL
    "((?:https?://|www\\.)[^\\s<>()\\[\\]]+)",
    // @First Last — the token the mention typeahead inserts
    "(@\\p{Lu}[\\p{L}\\p{N}'’.-]*(?: \\p{Lu}[\\p{L}\\p{N}'’.-]*)?)",
  ].join("|"),
  "gu",
);

/** Split one line of text into inline nodes. */
export function parseInline(line: string): InlineNode[] {
  const out: InlineNode[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m.index > last) out.push({ type: "text", value: line.slice(last, m.index) });
    const token = m[0];
    if (m[1]) {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = safeHref(token.slice(close + 2, -1));
      if (href) out.push({ type: "link", href, label });
      else out.push({ type: "text", value: token });
    } else if (m[2]) {
      out.push({ type: "bold", value: token.slice(2, -2) });
    } else if (m[3]) {
      out.push({ type: "italic", value: token.slice(1, -1) });
    } else if (m[4]) {
      const href = safeHref(token);
      if (href) out.push({ type: "link", href, label: token });
      else out.push({ type: "text", value: token });
    } else {
      out.push({ type: "mention", label: token });
    }
    last = m.index + token.length;
  }
  if (last < line.length) out.push({ type: "text", value: line.slice(last) });
  if (out.length === 0) out.push({ type: "text", value: "" });
  return mergeText(out);
}

/** Adjacent text nodes become one, so a rejected link is a single run of
 *  characters rather than the three fragments its regex left behind. */
function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.type === "text" && prev && prev.type === "text") {
      out[out.length - 1] = { type: "text", value: prev.value + node.value };
    } else {
      out.push(node);
    }
  }
  return out;
}

const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBER_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/;

/**
 * Parse a whole description or comment body into blocks.
 *
 * Consecutive non-empty lines stay in one paragraph with their line breaks
 * preserved, because that is what a person who typed plain text meant.
 */
export function parseMarkdownLite(source: string): BlockNode[] {
  const lines = (source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];
  let numberStart = 1;

  const flushPara = () => {
    if (!para.length) return;
    const content: InlineNode[] = [];
    para.forEach((line, i) => {
      if (i > 0) content.push({ type: "text", value: "\n" });
      content.push(...parseInline(line));
    });
    blocks.push({ type: "paragraph", content });
    para = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push({ type: "bullets", items: bullets.map(parseInline) });
    bullets = [];
  };
  const flushNumbers = () => {
    if (!numbers.length) return;
    blocks.push({ type: "numbers", items: numbers.map(parseInline), start: numberStart });
    numbers = [];
  };
  const flushAll = () => {
    flushPara();
    flushBullets();
    flushNumbers();
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const b = BULLET_RE.exec(line);
    if (b) {
      flushPara();
      flushNumbers();
      bullets.push(b[1]);
      continue;
    }
    const n = NUMBER_RE.exec(line);
    if (n) {
      flushPara();
      flushBullets();
      if (!numbers.length) numberStart = Number(n[1]) || 1;
      numbers.push(n[2]);
      continue;
    }
    flushBullets();
    flushNumbers();
    para.push(line);
  }
  flushAll();
  return blocks;
}

/** Is there anything to render? An all-whitespace body is empty. */
export function isBlankBody(source: string | null | undefined): boolean {
  return !source || !source.trim();
}

/**
 * The one or two lines a card shows instead of the body.
 *
 * A card preview is not a document: it prints into a `line-clamp-2` box where
 * newlines collapse and a real `<ul>` would be clipped mid-item. So this
 * flattens the body to a single run of words, dropping the syntax a reader
 * should never see raw: the "- " and "1. " that open a list item, the "**"
 * around a bold run, the "(https://...)" half of a link.
 *
 * It takes meaning away on purpose, which is the opposite of the parser above,
 * and that is why it is a preview and never a render. Plain text goes through
 * it unchanged apart from whitespace collapsing, because plain text has no
 * markers to strip.
 */
export function descriptionPreview(source: string | null | undefined, maxChars = 160): string {
  if (!source) return "";
  const parts: string[] = [];
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    const b = BULLET_RE.exec(raw);
    const n = b ? null : NUMBER_RE.exec(raw);
    const body = b ? b[1] : n ? n[2] : raw;
    const text = inlineText(parseInline(body)).replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  }
  const joined = parts.join(" ");
  if (joined.length <= maxChars) return joined;
  const cut = joined.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");
  const kept = space > maxChars * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}…`;
}

/** The characters a reader would see, with the markers spent. */
function inlineText(nodes: InlineNode[]): string {
  return nodes.map((n) => (n.type === "link" || n.type === "mention" ? n.label : n.value)).join("");
}

const BULLET_PREFIX_RE = /^(\s*)([-*])(\s+)/;
const NUMBER_PREFIX_RE = /^(\s*)(\d{1,3})([.)])(\s+)/;

/**
 * What Enter does inside a list, as a pure function of the value and caret.
 *
 * Returns null whenever the caret is not sitting after a list marker, so the
 * textarea's own newline stands and nothing about typing prose changes. When
 * it does return, the caller replaces the value and the selection:
 *
 *   * Enter in a list item that has text continues the list, carrying the
 *     indent, the same bullet character, or the next number;
 *   * Enter in an EMPTY list item ends the list by taking the marker off,
 *     which is how a person gets back to a paragraph without reaching for
 *     Backspace.
 *
 * It only ever edits the current line. Nothing before `lineStart` or after
 * `lineEnd` is touched, so no text a person wrote can be lost here.
 */
export function continueList(value: string, caret: number): WrapResult | null {
  const pos = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const lineEndRaw = value.indexOf("\n", pos);
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
  const line = value.slice(lineStart, lineEnd);

  const bullet = BULLET_PREFIX_RE.exec(line);
  const number = bullet ? null : NUMBER_PREFIX_RE.exec(line);
  const marker = bullet ?? number;
  if (!marker) return null;

  // Caret inside or before the marker: that is somebody editing the marker
  // itself, and a plain newline is the honest answer.
  if (pos < lineStart + marker[0].length) return null;

  const content = line.slice(marker[0].length);
  if (!content.trim()) {
    // End the list. The marker goes, the line becomes empty, the caret sits
    // where the text would start. Everything on other lines survives.
    return {
      value: value.slice(0, lineStart) + value.slice(lineEnd),
      selectionStart: lineStart,
      selectionEnd: lineStart,
    };
  }

  const prefix = bullet
    ? `${bullet[1]}${bullet[2]}${bullet[3]}`
    : `${marker[1]}${Number(marker[2]) + 1}${marker[3]}${marker[4]}`;
  const insert = `\n${prefix}`;
  return {
    value: value.slice(0, pos) + insert + value.slice(pos),
    selectionStart: pos + insert.length,
    selectionEnd: pos + insert.length,
  };
}

export type WrapStyle = "bold" | "italic" | "bullet" | "number" | "link";

export interface WrapResult {
  value: string;
  /** Where the caret (or selection) should land after the edit. */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * What the toolbar does to the text, as a pure function of the current value
 * and selection, so the behaviour is testable without a DOM.
 *
 * Bold and italic toggle: applying them to text that already carries the
 * marker strips it, which is what every editor does and what stops
 * "****word****" after two clicks.
 */
export function applyWrap(value: string, start: number, end: number, style: WrapStyle): WrapResult {
  const selected = value.slice(start, end);

  if (style === "bold" || style === "italic") {
    const marker = style === "bold" ? "**" : "*";
    const already =
      selected.length > marker.length * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker);
    if (already) {
      const inner = selected.slice(marker.length, -marker.length);
      return {
        value: value.slice(0, start) + inner + value.slice(end),
        selectionStart: start,
        selectionEnd: start + inner.length,
      };
    }
    const placeholder = selected || (style === "bold" ? "bold text" : "italic text");
    const next = `${marker}${placeholder}${marker}`;
    return {
      value: value.slice(0, start) + next + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + placeholder.length,
    };
  }

  if (style === "link") {
    const label = selected || "link text";
    const next = `[${label}](https://)`;
    return {
      value: value.slice(0, start) + next + value.slice(end),
      // Land inside the href, which is the part that always needs typing.
      selectionStart: start + label.length + 3 + 8,
      selectionEnd: start + label.length + 3 + 8,
    };
  }

  // Lists work on whole lines, so widen the selection to line boundaries.
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndRaw = value.indexOf("\n", end);
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
  const region = value.slice(lineStart, lineEnd);
  const lines = region.split("\n");
  const prefixOf = (i: number) => (style === "bullet" ? "- " : `${i + 1}. `);
  const allMarked = lines.every((l) => (style === "bullet" ? BULLET_RE.test(l) : NUMBER_RE.test(l)));
  const next = lines
    .map((l, i) => {
      if (allMarked) {
        const m = style === "bullet" ? BULLET_RE.exec(l) : NUMBER_RE.exec(l);
        return m ? (style === "bullet" ? m[1] : m[2]) : l;
      }
      return `${prefixOf(i)}${l.replace(BULLET_RE, "$1").replace(NUMBER_RE, "$2")}`;
    })
    .join("\n");
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  };
}
