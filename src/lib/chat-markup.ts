// Room message markup — Slack's mrkdwn-shaped subset, ours end to end.
//
// Stored bodies are plain text with light markers; this module is the
// single source of truth for how they parse. Pure + tested: the React
// renderer (components/chat/rich-body.tsx) walks the AST this emits,
// and stripMarkup DERIVES from the same parse so previews can never
// disagree with renders.
//
// Subset (paired markers only — an unmatched marker is literal text):
//   **bold**   _italic_   __underline__   ~strike~   `code`
//   ```fenced code blocks```   > quote lines   - bullets   1. ordered
//   [label](https://url)   bare URLs auto-link
//
// The inline parser is a single LEFT-TO-RIGHT scanner: at each position
// it tries code span (same-line close required), labelled link, bare
// URL, then wrap markers longest-first; the LEFTMOST construct wins, so
// __**x**__ nests correctly, a whitespace-only pair falls back to a
// literal character without disabling later pairs, and any number of
// sibling spans parse (the depth cap only bounds true nesting).

export type InlineNode =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "link"; label: string; href: string }
  | { t: "url"; href: string }
  | { t: "bold" | "italic" | "underline" | "strike"; children: InlineNode[] };

export type BlockNode =
  | { t: "p"; children: InlineNode[] }
  | { t: "codeblock"; text: string }
  | { t: "quote"; lines: InlineNode[][] }
  | { t: "ul"; items: InlineNode[][] }
  | { t: "ol"; start: number; items: InlineNode[][] };

const MAX_DEPTH = 4;
// Sticky (anchored) regexes: matching happens AT the scan position only —
// no global backtracking over '['-runs (the quadratic-scan fleet finding).
const LINK_AT = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,1000})\)/y;
const URL_AT = /https?:\/\/[^\s<>"）)]{1,1000}/y;
const WRAPS: { marker: string; t: "bold" | "underline" | "italic" | "strike" }[] = [
  { marker: "**", t: "bold" },
  { marker: "__", t: "underline" },
  { marker: "_", t: "italic" },
  { marker: "~", t: "strike" },
];

/** Parse one body into block nodes. Never throws on any input. */
export function parseMarkup(body: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const parts = body.split("```");
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      if (i === parts.length - 1) {
        // Dangling fence — the marker and its tail stay visible as text.
        pushLines(blocks, "```" + parts[i]);
      } else {
        blocks.push({ t: "codeblock", text: parts[i].replace(/^\n/, "").replace(/\n$/, "") });
      }
    } else if (parts[i] !== "") {
      pushLines(blocks, parts[i]);
    }
  }
  return blocks;
}

function pushLines(blocks: BlockNode[], text: string) {
  const lines = text.split("\n");
  // Blank lines stay INSIDE a paragraph (rendered by whitespace-pre-wrap),
  // exactly as plain messages always rendered — only a block-type change
  // (quote/list/fence) breaks a paragraph. Fleet finding: flushing on
  // blank lines silently collapsed the gaps in existing messages.
  let para: string[] = [];
  let quote: InlineNode[][] = [];
  let ul: InlineNode[][] = [];
  let ol: InlineNode[][] = [];
  let olStart = 1;

  const flushPara = () => {
    // Leading/trailing blank runs inside a paragraph are kept verbatim.
    while (para.length > 0 && para[para.length - 1] === "") para.pop();
    while (para.length > 0 && para[0] === "") para.shift();
    if (para.length > 0) { blocks.push({ t: "p", children: parseInline(para.join("\n")) }); para = []; }
  };
  const flushQuote = () => { if (quote.length > 0) { blocks.push({ t: "quote", lines: quote }); quote = []; } };
  const flushUl = () => { if (ul.length > 0) { blocks.push({ t: "ul", items: ul }); ul = []; } };
  const flushOl = () => { if (ol.length > 0) { blocks.push({ t: "ol", start: olStart, items: ol }); ol = []; olStart = 1; } };

  for (const line of lines) {
    const q = line.match(/^>\s?(.*)$/);
    // 1-2 digits only: "2025. was a big year" is a sentence, not a list
    // (fleet finding — unbounded \d+ rewrote plain text).
    const b = line.match(/^[-*]\s+(.*)$/);
    const o = line.match(/^(\d{1,2})[.)]\s+(.*)$/);
    if (q) { flushPara(); flushUl(); flushOl(); quote.push(parseInline(q[1])); }
    else if (b) { flushPara(); flushQuote(); flushOl(); ul.push(parseInline(b[1])); }
    else if (o) {
      flushPara(); flushQuote(); flushUl();
      if (ol.length === 0) olStart = Math.max(1, parseInt(o[1], 10));
      ol.push(parseInline(o[2]));
    } else {
      flushQuote(); flushUl(); flushOl();
      para.push(line);
    }
  }
  flushPara(); flushQuote(); flushUl(); flushOl();
}

/** Single-pass leftmost scanner. */
export function parseInline(text: string, depth = 0): InlineNode[] {
  const out: InlineNode[] = [];
  let lit = "";
  const flushLit = () => { if (lit !== "") { out.push({ t: "text", text: lit }); lit = ""; } };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // Code span: parity-real — needs an actual closing backtick on the
    // SAME line (a "`" with no same-line partner is a literal char).
    if (ch === "`") {
      const nl = text.indexOf("\n", i + 1);
      const close = text.indexOf("`", i + 1);
      if (close !== -1 && (nl === -1 || close < nl) && close > i + 1) {
        flushLit();
        out.push({ t: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      lit += ch; i++; continue;
    }

    // Labelled link at this exact position.
    if (ch === "[") {
      LINK_AT.lastIndex = i;
      const m = LINK_AT.exec(text);
      if (m) {
        flushLit();
        out.push({ t: "link", label: m[1], href: m[2] });
        i = LINK_AT.lastIndex;
        continue;
      }
      lit += ch; i++; continue;
    }

    // Bare URL at this exact position.
    if (ch === "h" && (text.startsWith("http://", i) || text.startsWith("https://", i))) {
      URL_AT.lastIndex = i;
      const m = URL_AT.exec(text);
      if (m) {
        flushLit();
        out.push({ t: "url", href: m[0] });
        i = URL_AT.lastIndex;
        continue;
      }
    }

    // Wrap markers, longest-first at THIS position. The close search runs
    // over the raw text, so links/URLs inside the pair stay inside it.
    if ((ch === "*" || ch === "_" || ch === "~") && depth < MAX_DEPTH) {
      let matched = false;
      for (const w of WRAPS) {
        if (!text.startsWith(w.marker, i)) continue;
        const close = text.indexOf(w.marker, i + w.marker.length);
        if (close === -1) continue;
        const inner = text.slice(i + w.marker.length, close);
        if (inner.trim() === "") {
          // "** **" is fully literal — consume the WHOLE pair so its
          // closer can't re-pair with the next opener down the line.
          lit += text.slice(i, close + w.marker.length);
          i = close + w.marker.length;
          matched = true;
          break;
        }
        if (inner.includes("\n")) {
          // Markers are line-scoped: literalize just the opener so a
          // pair later on the next line still parses.
          lit += w.marker;
          i += w.marker.length;
          matched = true;
          break;
        }
        flushLit();
        out.push({ t: w.t, children: parseInline(inner, depth + 1) });
        i = close + w.marker.length;
        matched = true;
        break;
      }
      if (matched) continue;
    }

    lit += ch; i++;
  }
  flushLit();
  return out;
}

/** Preview text derived from the SAME parse the renderer uses — code
 *  content stays verbatim, links keep their labels, structure flattens
 *  to lines. Render and preview can never disagree. */
export function stripMarkup(body: string): string {
  const inlineText = (nodes: InlineNode[]): string => nodes.map((n) => {
    switch (n.t) {
      case "text": return n.text;
      case "code": return n.text;
      case "link": return n.label;
      case "url": return n.href;
      default: return inlineText(n.children);
    }
  }).join("");

  return parseMarkup(body).map((b) => {
    switch (b.t) {
      case "codeblock": return b.text;
      case "quote": return b.lines.map(inlineText).join("\n");
      case "ul": return b.items.map(inlineText).join("\n");
      case "ol": return b.items.map(inlineText).join("\n");
      default: return inlineText(b.children);
    }
  }).join("\n").replace(/\n{3,}/g, "\n\n");
}
