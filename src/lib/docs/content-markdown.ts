// A Doc's content as Markdown, whichever format it was saved in.
//
// Three formats live in Doc.content (read on the local database, 2026-10-03):
//
//   { bnDoc: [...], blocks: [...] }   the BlockNote editor (today). bnDoc is
//                                     the real tree: nested children, inline
//                                     styles, links, mentions, tables. blocks
//                                     is a flat copy kept for old readers.
//   { type: "doc", content: [...] }   TipTap / ProseMirror JSON (older docs).
//   { blocks: [{ kind, text }] }      the first block editor.
//
// The single-doc export (GET /api/docs/[id]/export) read only `blocks`, so a
// TipTap doc exported as its title alone and a BlockNote doc lost its nesting
// and styles. Both exports read this now.
//
// What has no Markdown form says so in place rather than vanishing (an
// embedded view, a table of contents). Attachments and images keep the link
// they were saved with; their files are not inside the text.
//
// Pure: no imports, so the export routes and the tests share it.

/** How a sub-page is linked: the path of its own exported file, or null for its title alone. */
export type DocLinker = (docId: string) => string | null;

export function docToMarkdown(title: string, content: unknown, linkDoc: DocLinker = () => null): string {
  const out: string[] = [];
  if (title.trim()) out.push(`# ${escapeText(title.trim())}`, "");
  const c = content && typeof content === "object" && !Array.isArray(content) ? (content as Record<string, unknown>) : null;
  let body = "";
  if (c && Array.isArray(c.bnDoc)) body = blockNoteToMarkdown(c.bnDoc, linkDoc);
  else if (c && c.type === "doc" && Array.isArray(c.content)) body = proseMirrorToMarkdown(c.content);
  else if (c && Array.isArray(c.blocks)) body = legacyBlocksToMarkdown(c.blocks, linkDoc);
  if (body.trim()) out.push(body.trim(), "");
  return tidy(out.join("\n"));
}

// ── Text ─────────────────────────────────────────────────────────────

/** Markdown's own characters in running text, escaped so they read as written. */
export function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]])/g, "\\$1");
}

function tidy(md: string): string {
  return md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function wrap(text: string, mark: string): string {
  // Markers hug the words, so leading or trailing spaces stay outside them.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m || !m[2]) return text;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

/** Inline code needs a fence longer than any run of backticks inside it. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

// ── BlockNote ────────────────────────────────────────────────────────

type BnBlock = { type?: unknown; props?: Record<string, unknown>; content?: unknown; children?: unknown };

function bnInline(content: unknown): string {
  if (typeof content === "string") return escapeText(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((node) => {
      if (!node || typeof node !== "object") return "";
      const n = node as { type?: unknown; text?: unknown; styles?: Record<string, unknown>; href?: unknown; content?: unknown; props?: Record<string, unknown> };
      if (n.type === "text") {
        const raw = str(n.text);
        const st = n.styles ?? {};
        if (st.code) return codeSpan(raw);
        let t = escapeText(raw);
        if (st.bold) t = wrap(t, "**");
        if (st.italic) t = wrap(t, "_");
        if (st.strike) t = wrap(t, "~~");
        return t;
      }
      if (n.type === "link") {
        const label = bnInline(n.content) || escapeText(str(n.href));
        return `[${label}](${str(n.href)})`;
      }
      if (n.type === "mention") return `@${escapeText(str(n.props?.label) || "someone")}`;
      return bnInline(n.content);
    })
    .join("");
}

function bnTable(content: unknown): string[] {
  const rows = (content as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const cells = rows.map((r) => {
    const list = (r as { cells?: unknown } | null)?.cells;
    return Array.isArray(list)
      ? list.map((cell) => {
          const inner = cell && typeof cell === "object" && !Array.isArray(cell) && "content" in (cell as object) ? (cell as { content?: unknown }).content : cell;
          return bnInline(inner).replace(/\|/g, "\\|").replace(/\n/g, " ");
        })
      : [];
  });
  const width = Math.max(...cells.map((r) => r.length), 1);
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [line(cells[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...cells.slice(1).map(line)];
}

export function blockNoteToMarkdown(blocks: readonly unknown[], linkDoc: DocLinker = () => null, depth = 0): string {
  const out: string[] = [];
  const indent = "  ".repeat(depth);
  let numbered = 0;
  let inList = false;
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as BnBlock;
    const type = str(b.type);
    const props = b.props ?? {};
    const text = bnInline(b.content);
    const kids = Array.isArray(b.children) ? b.children : [];
    numbered = type === "numberedListItem" ? numbered + 1 : 0;
    const listItem = type === "bulletListItem" || type === "numberedListItem" || type === "checkListItem" || type === "toggleListItem";
    // A list ends with a blank line, or Markdown reads the next block as
    // part of its last item.
    if (inList && !listItem) out.push("");
    inList = listItem;
    switch (type) {
      case "heading": {
        const level = Math.min(Math.max(Number(props.level) || 1, 1), 6);
        out.push(`${"#".repeat(level)} ${text}`, "");
        break;
      }
      case "bulletListItem":
        out.push(`${indent}- ${text}`);
        break;
      case "numberedListItem":
        out.push(`${indent}${numbered}. ${text}`);
        break;
      case "checkListItem":
        out.push(`${indent}- [${props.checked ? "x" : " "}] ${text}`);
        break;
      case "toggleListItem":
        out.push(`${indent}- ${text}`);
        break;
      case "quote":
        out.push(...text.split("\n").map((l) => `${indent}> ${l}`), "");
        break;
      case "codeBlock": {
        const code = Array.isArray(b.content) ? (b.content as Array<{ text?: unknown }>).map((n) => str(n?.text)).join("") : str(b.content);
        const fence = code.includes("```") ? "````" : "```";
        out.push(`${indent}${fence}${str(props.language)}`, ...code.split("\n").map((l) => `${indent}${l}`), `${indent}${fence}`, "");
        break;
      }
      case "callout":
        out.push(`${indent}> ${str(props.emoji) ? `${str(props.emoji)} ` : ""}${text}`, "");
        break;
      case "image": {
        const url = str(props.url);
        const alt = escapeText(str(props.caption) || str(props.name) || "image");
        if (url) out.push(`${indent}![${alt}](${url})`, "");
        break;
      }
      case "video":
      case "audio":
      case "file": {
        const url = str(props.url);
        const name = escapeText(str(props.name) || str(props.caption) || type);
        if (url) out.push(`${indent}[${name}](${url})`, "");
        break;
      }
      case "videoEmbed":
      case "bookmark": {
        const url = str(props.url);
        if (!url) break;
        const label = escapeText(str(props.title) || url);
        out.push(`${indent}[${label}](${url})`);
        if (str(props.description)) out.push(`${indent}${escapeText(str(props.description))}`);
        out.push("");
        break;
      }
      case "equation":
        if (str(props.latex)) out.push(`${indent}$$`, `${indent}${str(props.latex)}`, `${indent}$$`, "");
        break;
      case "subpage": {
        const label = escapeText(`${str(props.emoji) ? `${str(props.emoji)} ` : ""}${str(props.title) || "Untitled page"}`);
        const href = str(props.childDocId) ? linkDoc(str(props.childDocId)) : null;
        out.push(`${indent}${href ? `[${label}](${href})` : label}`, "");
        break;
      }
      case "table":
        out.push(...bnTable(b.content).map((l) => `${indent}${l}`), "");
        break;
      case "toc":
        out.push(`${indent}_Table of contents_`, "");
        break;
      default:
        // A paragraph, columns (their text, then each column below) and any
        // block this file does not know yet: its text is never lost.
        if (text) out.push(`${indent}${text}`, "");
        else if (type === "paragraph") out.push("");
    }
    if (kids.length > 0) {
      // A list item's children nest under it; anything else's follow it.
      const inner = blockNoteToMarkdown(kids, linkDoc, listItem ? depth + 1 : depth);
      if (inner.trim()) out.push(inner.trimEnd(), ...(listItem ? [] : [""]));
    }
  }
  return out.join("\n");
}

// ── TipTap / ProseMirror ─────────────────────────────────────────────

type PmNode = { type?: unknown; attrs?: Record<string, unknown>; content?: unknown; text?: unknown; marks?: unknown };

function pmInline(nodes: unknown): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((raw) => {
      if (!raw || typeof raw !== "object") return "";
      const n = raw as PmNode;
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "mention") return `@${escapeText(str(n.attrs?.label) || str(n.attrs?.id) || "someone")}`;
      if (n.type === "image") return str(n.attrs?.src) ? `![${escapeText(str(n.attrs?.alt) || "image")}](${str(n.attrs?.src)})` : "";
      if (n.type !== "text") return pmInline(n.content);
      const marks = Array.isArray(n.marks) ? (n.marks as Array<{ type?: unknown; attrs?: Record<string, unknown> }>) : [];
      const has = (t: string) => marks.some((m) => m?.type === t);
      const raw2 = str(n.text);
      if (has("code")) return codeSpan(raw2);
      let t = escapeText(raw2);
      if (has("bold")) t = wrap(t, "**");
      if (has("italic")) t = wrap(t, "_");
      if (has("strike")) t = wrap(t, "~~");
      const link = marks.find((m) => m?.type === "link");
      if (link && str(link.attrs?.href)) t = `[${t}](${str(link.attrs?.href)})`;
      return t;
    })
    .join("");
}

export function proseMirrorToMarkdown(nodes: readonly unknown[], depth = 0): string {
  const out: string[] = [];
  const indent = "  ".repeat(depth);
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const n = raw as PmNode;
    const kids = Array.isArray(n.content) ? (n.content as unknown[]) : [];
    switch (str(n.type)) {
      case "heading":
        out.push(`${"#".repeat(Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 6))} ${pmInline(kids)}`, "");
        break;
      case "paragraph":
        out.push(`${indent}${pmInline(kids)}`, "");
        break;
      case "blockquote":
        out.push(...proseMirrorToMarkdown(kids).trim().split("\n").map((l) => `${indent}> ${l}`), "");
        break;
      case "codeBlock": {
        const code = kids.map((k) => str((k as PmNode)?.text)).join("");
        out.push(`${indent}\`\`\`${str(n.attrs?.language)}`, ...code.split("\n").map((l) => `${indent}${l}`), `${indent}\`\`\``, "");
        break;
      }
      case "horizontalRule":
        out.push("---", "");
        break;
      case "bulletList":
      case "orderedList":
      case "taskList": {
        let i = Number(n.attrs?.start) || 1;
        for (const item of kids) {
          const it = item as PmNode;
          const parts = Array.isArray(it?.content) ? (it.content as PmNode[]) : [];
          const first = parts.find((p) => p?.type === "paragraph");
          const rest = parts.filter((p) => p !== first);
          const marker = n.type === "orderedList" ? `${i++}.` : n.type === "taskList" ? `- [${it?.attrs?.checked ? "x" : " "}]` : "-";
          out.push(`${indent}${marker} ${first ? pmInline(first.content) : ""}`);
          const nested = proseMirrorToMarkdown(rest, depth + 1).trimEnd();
          if (nested.trim()) out.push(nested);
        }
        out.push("");
        break;
      }
      case "table": {
        const rows = kids.map((row) =>
          (Array.isArray((row as PmNode)?.content) ? ((row as PmNode).content as PmNode[]) : []).map((cell) =>
            proseMirrorToMarkdown(Array.isArray(cell?.content) ? (cell.content as unknown[]) : []).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|"),
          ),
        );
        if (rows.length === 0) break;
        const width = Math.max(...rows.map((r) => r.length), 1);
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
        out.push(line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line), "");
        break;
      }
      case "image":
        if (str(n.attrs?.src)) out.push(`![${escapeText(str(n.attrs?.alt) || "image")}](${str(n.attrs?.src)})`, "");
        break;
      default: {
        const text = pmInline(kids);
        if (text) out.push(`${indent}${text}`, "");
      }
    }
  }
  return out.join("\n");
}

// ── The first block editor ───────────────────────────────────────────

/** Its HTML-flavoured text, plain: mentions keep their @name, line breaks stay. */
function stripHtml(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/<a[^>]*class="[^"]*bmen-inline[^"]*"[^>]*>(@[^<]+)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export function legacyBlocksToMarkdown(blocks: readonly unknown[], linkDoc: DocLinker = () => null): string {
  const out: string[] = [];
  let numbered = 0;
  let inList = false;
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const kind = str(block.kind);
    numbered = kind === "numbered" ? numbered + 1 : 0;
    const text = stripHtml(block.text);
    const listItem = kind === "bullet" || kind === "numbered" || kind === "todo";
    if (inList && !listItem) out.push("");
    inList = listItem;
    switch (kind) {
      case "h1": out.push(`# ${text}`, ""); break;
      case "h2": out.push(`## ${text}`, ""); break;
      case "h3": out.push(`### ${text}`, ""); break;
      case "paragraph": out.push(text, ""); break;
      case "bullet": out.push(`- ${text}`); break;
      case "numbered": out.push(`${numbered}. ${text}`); break;
      case "todo": out.push(`- [${block.done ? "x" : " "}] ${text}`); break;
      case "quote": out.push(`> ${text}`, ""); break;
      case "code": out.push(`\`\`\`${str(block.lang)}`, str(block.text), "```", ""); break;
      case "divider": out.push("---", ""); break;
      case "callout": out.push(`> **${str(block.tone || "info").toUpperCase()}**: ${text}`, ""); break;
      case "toggle": {
        const body = stripHtml(block.body);
        out.push(body ? `<details><summary>${text}</summary>\n\n${body}\n\n</details>` : `<details><summary>${text}</summary></details>`, "");
        break;
      }
      case "image": {
        const url = str(block.url);
        if (url) out.push(`![${str(block.alt)}](${url})`, "");
        if (block.caption) out.push(`_${stripHtml(block.caption)}_`, "");
        break;
      }
      case "file": out.push(`[${str(block.name) || "file"}](${str(block.url)})`, ""); break;
      case "embed": if (str(block.url)) out.push(`<${str(block.url)}>`, ""); break;
      case "entity_link": out.push(`@${str(block.label) || "entity"} (${str(block.entityKind)})`, ""); break;
      case "sop_card": out.push(`SOP: ${str(block.sopId)}`, ""); break;
      case "task_card": out.push(`Task: ${str(block.taskId)}`, ""); break;
      case "note_card": out.push(`Note: ${str(block.noteId)}`, ""); break;
      case "subpage": {
        const label = escapeText(str(block.title) || "Sub-page");
        const href = str(block.childDocId) ? linkDoc(str(block.childDocId)) : null;
        out.push(href ? `[${label}](${href})` : label, "");
        break;
      }
      case "ai_write": if (block.result) out.push(str(block.result), ""); break;
      case "tasks_view": case "studio_board": case "sops_list":
      case "meetings_view": case "form": case "data_table":
        out.push(`_Embedded ${kind.replace(/_/g, " ")}_`, "");
        break;
      default:
        if (text) out.push(text, "");
    }
  }
  return out.join("\n");
}
