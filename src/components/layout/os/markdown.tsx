"use client";

/* Tiny no-dependency markdown renderer.
 * Handles what Claude actually produces in chat replies:
 * paragraphs, **bold**, *italic*, `inline code`, headings (#, ##, ###),
 * unordered + ordered lists, code fences ```lang ... ```, and links.
 *
 * Block-level parsing is line-based; inline runs through a regex
 * tokenizer. Safer than dangerouslySetInnerHTML — we render everything
 * as React elements.
 */

type Inline = string | React.ReactElement;

function renderInline(text: string, keyPrefix: string): Inline[] {
  const out: Inline[] = [];
  // tokenize ` `, **, *, [text](url) — process left-to-right
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkMatch) {
        out.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>,
        );
      } else {
        out.push(tok);
      }
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

export function OsMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
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
      blocks.push(<pre key={`b${bi++}`}><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    // Heading
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      const text = line.replace(/^#+\s/, "");
      const Tag = (`h${Math.min(level, 3)}`) as "h1" | "h2" | "h3";
      blocks.push(<Tag key={`b${bi++}`}>{renderInline(text, `b${bi}`)}</Tag>);
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s/, ""));
        i++;
      }
      blocks.push(
        <ul key={`b${bi++}`}>
          {items.map((it, j) => <li key={j}>{renderInline(it, `b${bi}-${j}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s/, ""));
        i++;
      }
      blocks.push(
        <ol key={`b${bi++}`}>
          {items.map((it, j) => <li key={j}>{renderInline(it, `b${bi}-${j}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Blank line — paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (consume until blank line / block boundary)
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(<p key={`b${bi++}`}>{renderInline(paraLines.join(" "), `b${bi}`)}</p>);
  }

  return <>{blocks}</>;
}
