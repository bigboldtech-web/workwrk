// create_doc's Markdown as a doc's blocks (docs/plans/mcp-server.md 4.3).
//
// The blocks are the first block editor's shape, { id, kind, text }, the one
// Ask AI's create_doc writes and every doc reader opens (content.blocks; the
// editor, the Notepad, the export, get_doc's docText):
//   # , ## , ###        h1, h2, h3
//   - [ ] and - [x]     a to-do, open or done
//   ***                 a divider (three or more of *, - or _)
//   anything else       a paragraph, one per line; blank lines are skipped
// Every text goes through the caller's clean (cleanOutwardText: links
// reduced to their words), and a line left empty by it is dropped.
//
// Pure.

export const MAX_DOC_BLOCKS = 200;

export type LegacyBlock =
  | { id: string; kind: "h1" | "h2" | "h3" | "paragraph"; text: string }
  | { id: string; kind: "todo"; text: string; done: boolean }
  | { id: string; kind: "divider" };

/** The blocks, or tooMany when there are more than MAX_DOC_BLOCKS (nothing is cut silently). */
export function markdownToBlocks(
  markdown: string,
  clean: (text: string) => string,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): { ok: true; blocks: LegacyBlock[] } | { ok: false; tooMany: true } {
  const blocks: LegacyBlock[] = [];
  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let block: LegacyBlock | null;
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.replace(/\s+/g, ""))) {
      block = { id: newId(), kind: "divider" };
    } else {
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      const todo = /^[-*+]\s+\[( |x|X)\]\s*(.*)$/.exec(line);
      if (heading) {
        const text = clean(heading[2]);
        block = text ? { id: newId(), kind: heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3", text } : null;
      } else if (todo) {
        const text = clean(todo[2]);
        block = text ? { id: newId(), kind: "todo", text, done: todo[1] !== " " } : null;
      } else {
        const text = clean(line);
        block = text ? { id: newId(), kind: "paragraph", text } : null;
      }
    }
    if (!block) continue;
    if (blocks.length >= MAX_DOC_BLOCKS) return { ok: false, tooMany: true };
    blocks.push(block);
  }
  return { ok: true, blocks };
}
