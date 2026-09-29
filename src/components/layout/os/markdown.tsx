"use client";

/* Tiny no-dependency markdown renderer for Ask AI answers.
 * Handles what the model actually writes in a chat reply: paragraphs,
 * **bold**, *italic*, `inline code`, headings (# to ######), unordered and
 * ordered lists, code fences, links, block quotes, horizontal rules (---,
 * ***, ___) and GitHub-style tables (a header row, a |---|:---:| divider
 * row, then body rows, with or without the outer pipes).
 *
 * Block-level parsing is line-based; inline runs through a regex
 * tokenizer. Everything renders as React elements, never raw HTML. Every
 * block carries its own classes, because the product's reset strips list
 * bullets, heading sizes and paragraph spacing. A link only renders for an
 * http(s), mailto or same-site address; anything else prints its text.
 */

type Inline = string | React.ReactElement;

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return null;
}

function renderInline(text: string, keyPrefix: string): Inline[] {
  const out: Inline[] = [];
  // tokenize `code`, **bold**, *italic*, [text](url), left to right
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key} className="rounded-sm bg-subtle px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const href = linkMatch ? safeHref(linkMatch[2]) : null;
      if (linkMatch && href) {
        const internal = href.startsWith("/");
        out.push(
          <a
            key={key}
            href={href}
            className="font-medium text-brand-deep underline-offset-2 hover:underline"
            {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        out.push(linkMatch ? linkMatch[1] : tok);
      }
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const UL = /^\s*[-*+]\s+/;
const OL = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s{0,3}>\s?/;
/** A table divider row: | --- | :---: | ---: | (the outer pipes optional). */
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of one table row, "| a | b |" or "a | b". */
export function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

export function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const div = lines[i + 1];
  if (head === undefined || div === undefined) return false;
  if (!head.includes("|")) return false;
  // A lone "---" under a line is a rule, not a one-column table.
  return div.includes("|") && TABLE_DIVIDER.test(div);
}

function alignOf(cell: string): "left" | "center" | "right" | undefined {
  const c = cell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  if (l && r) return "center";
  if (r) return "right";
  if (l) return "left";
  return undefined;
}

function isBlockStart(lines: string[], i: number): boolean {
  const l = lines[i];
  return (
    l.trim() === "" ||
    l.startsWith("```") ||
    HEADING.test(l) ||
    HR.test(l) ||
    UL.test(l) ||
    OL.test(l) ||
    QUOTE.test(l) ||
    isTableStart(lines, i)
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 mb-2 text-lg font-semibold text-ink first:mt-0",
  2: "mt-4 mb-2 text-base font-semibold text-ink first:mt-0",
};
const HEADING_SMALL = "mt-3 mb-1.5 text-base font-semibold text-ink first:mt-0";

export function OsMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactElement[] = [];

  let i = 0;
  let bi = 0; // block index
  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push(
        <pre key={`b${bi++}`} className="my-2 overflow-x-auto rounded-md bg-subtle p-3 font-mono text-sm text-ink">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Horizontal rule (before lists: "* * *" and "---" are rules)
    if (HR.test(line)) {
      blocks.push(<hr key={`b${bi++}`} className="my-4 border-0 border-t border-line-soft" />);
      i++;
      continue;
    }

    // Heading
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const Tag = (`h${level}`) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const key = `b${bi++}`;
      blocks.push(
        <Tag key={key} className={HEADING_CLASS[level] ?? HEADING_SMALL}>
          {renderInline(h[2].replace(/\s+#+\s*$/, ""), key)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Table
    if (isTableStart(lines, i)) {
      const head = tableCells(lines[i]);
      const aligns = tableCells(lines[i + 1]).map(alignOf);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        body.push(tableCells(lines[i]));
        i++;
      }
      const cols = Math.max(head.length, ...body.map((r) => r.length));
      const key = `b${bi++}`;
      blocks.push(
        <div key={key} className="my-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-subtle">
              <tr>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} scope="col" style={aligns[c] ? { textAlign: aligns[c] } : undefined} className="border-b border-line px-3 py-2 text-start font-medium text-ink-2">
                    {renderInline(head[c] ?? "", `${key}-h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="border-b border-line-soft last:border-b-0">
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} style={aligns[c] ? { textAlign: aligns[c] } : undefined} className="px-3 py-2 align-top text-ink">
                      {renderInline(row[c] ?? "", `${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Block quote
    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      const key = `b${bi++}`;
      blocks.push(
        <blockquote key={key} className="my-2 border-s-2 border-line-strong ps-3 text-ink-2">
          {renderInline(buf.join(" "), key)}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL.test(lines[i])) {
        items.push(lines[i].replace(UL, ""));
        i++;
      }
      const key = `b${bi++}`;
      blocks.push(
        <ul key={key} className="my-2 list-disc ps-5">
          {items.map((it, j) => <li key={j} className="my-0.5">{renderInline(it, `${key}-${j}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL.test(lines[i])) {
        items.push(lines[i].replace(OL, ""));
        i++;
      }
      const key = `b${bi++}`;
      blocks.push(
        <ol key={key} className="my-2 list-decimal ps-5">
          {items.map((it, j) => <li key={j} className="my-0.5">{renderInline(it, `${key}-${j}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Blank line: paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (consume until a blank line or another block starts)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines, i)) {
      paraLines.push(lines[i]);
      i++;
    }
    const key = `b${bi++}`;
    blocks.push(<p key={key} className="my-2 first:mt-0 last:mb-0">{renderInline(paraLines.join(" "), key)}</p>);
  }

  return <>{blocks}</>;
}
