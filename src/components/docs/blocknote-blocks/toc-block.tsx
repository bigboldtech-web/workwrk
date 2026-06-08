"use client";

/*
 * TableOfContentsBlock — Notion-style "Table of contents" for BlockNote.
 *
 * A non-editable block (content: "none") that renders a live, clickable
 * outline built from the document's heading blocks. It subscribes to the
 * editor so it stays in sync as headings are added / renamed / removed.
 *
 * Clicking an entry scrolls its heading into view. Headings are located in
 * the DOM by their `data-id` attribute (BlockNote sets this on every block).
 *
 * Mirrored to the legacy `blocks` array as a paragraph proxy (it carries no
 * authored text), but it is NOT in LEGACY_CUSTOM_EMBED_KINDS — there's
 * nothing to preserve, it re-derives itself from the live document.
 */

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useState } from "react";
import { ListTree } from "lucide-react";

type Entry = { id: string; level: number; text: string };

// Flatten BlockNote inline content (string | array | undefined) to text.
function inlineText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export const tocBlockSpec = createReactBlockSpec(
  {
    type: "toc",
    propSchema: {},
    content: "none",
  },
  {
    // Delegate to an uppercase-named component so hooks live in a real
    // component (matches the subpage block's pattern).
    render: ({ editor }) => <TableOfContentsView editor={editor as unknown as TocEditor} />,
  },
);

// Minimal shape we read off the live editor — its `document` plus a change
// subscription. The custom-block editor is typed to only know "toc", so we
// adapt through this loose interface.
type TocEditor = {
  document: Array<{ id: string; type: string; props?: { level?: number }; content?: unknown }>;
  onChange: (cb: () => void) => (() => void) | undefined;
};

function TableOfContentsView({ editor }: { editor: TocEditor }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  // Recompute the outline whenever the document changes. Cheap — a single
  // pass over top-level blocks picking out headings.
  useEffect(() => {
    const compute = () => {
      const next: Entry[] = [];
      for (const b of editor.document) {
        if (b.type === "heading") {
          next.push({ id: b.id, level: b.props?.level ?? 1, text: inlineText(b.content) || "Untitled section" });
        }
      }
      setEntries(next);
    };
    compute();
    const unsub = editor.onChange(compute);
    return () => { unsub?.(); };
  }, [editor]);

  const minLevel = entries.length ? Math.min(...entries.map((e) => e.level)) : 1;

  return (
    <div className="bn-toc" contentEditable={false}>
      <div className="bn-toc__head">
        <ListTree />
        <span>Table of contents</span>
      </div>
      {entries.length === 0 ? (
        <div className="bn-toc__empty">Add headings to populate this table of contents.</div>
      ) : (
        <ul className="bn-toc__list">
          {entries.map((e) => (
            <li
              key={e.id}
              className="bn-toc__item"
              style={{ paddingLeft: `${(e.level - minLevel) * 16}px` }}
            >
              <button
                type="button"
                className="bn-toc__link"
                onClick={() => {
                  const el = document.querySelector(`[data-id="${e.id}"]`);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {e.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
