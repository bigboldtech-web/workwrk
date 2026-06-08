"use client";

/*
 * SubpageBlock — Notion-style sub-page block for BlockNote.
 *
 * Represents a child-doc link inside another doc:
 *   props: { childDocId: string, title: string, emoji?: string }
 *
 * Two visual states:
 *   - Configured  (childDocId set):  Card with emoji + title + chevron;
 *                                    clicking navigates to /docs/<childDocId>.
 *   - Unconfigured (empty childDocId): Inline picker — search box +
 *                                       recent notes list. Picking writes
 *                                       props back via editor.updateBlock.
 *
 * Persisted to the polymorphic EntityLink graph via syncLinksFromBlocks
 * — that path reads `content.blocks` (legacy mirror) where each BN
 * subpage block is mirrored back to { kind: "subpage", childDocId, title }.
 */

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, Loader2, Search } from "lucide-react";

type DocRow = { id: string; title: string };

export const subpageBlockSpec = createReactBlockSpec(
  {
    type: "subpage",
    propSchema: {
      childDocId: { default: "" as string },
      title: { default: "" as string },
      emoji: { default: "" as string },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      // The block's props live on `block.props`. Updates round-trip
      // through `editor.updateBlock(block, { props: { ... } })`.
      const { childDocId, title, emoji } = block.props as {
        childDocId: string;
        title: string;
        emoji: string;
      };

      if (childDocId) {
        return <SubpageConfigured childDocId={childDocId} title={title} emoji={emoji} />;
      }
      return (
        <SubpagePicker
          onPick={(row) => {
            editor.updateBlock(block, {
              props: { childDocId: row.id, title: row.title || "Untitled note", emoji: "" },
            });
          }}
        />
      );
    },
  },
);

// ───────── Configured state ─────────

function SubpageConfigured({
  childDocId,
  title,
  emoji,
}: {
  childDocId: string;
  title: string;
  emoji: string;
}) {
  const router = useRouter();
  // Show the child's live title/icon so renaming the child updates the inline
  // link. Falls back to the stored props until the fetch resolves.
  const [liveTitle, setLiveTitle] = useState(title);
  const [liveEmoji, setLiveEmoji] = useState(emoji);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${childDocId}`);
        if (!res.ok) return;
        const d = await res.json();
        const doc = d.doc ?? d.data ?? d;
        if (cancelled) return;
        if (doc?.title) setLiveTitle(doc.title);
        const ic = doc?.content?.meta?.icon;
        if (ic && !/^https?:\/\//.test(ic) && !ic.startsWith("lucide:")) setLiveEmoji(ic);
      } catch { /* keep stored props */ }
    })();
    return () => { cancelled = true; };
  }, [childDocId]);

  const shown = liveTitle || "Untitled note";
  return (
    <button
      type="button"
      className="bn-subpage bn-subpage--configured"
      contentEditable={false}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(`/docs/${childDocId}`);
      }}
      title={shown}
    >
      <span className="bn-subpage__icon" aria-hidden>
        {liveEmoji || <FileText />}
      </span>
      <span className="bn-subpage__title">{shown}</span>
      <ChevronRight className="bn-subpage__chev" />
    </button>
  );
}

// ───────── Inline picker state ─────────

function SubpagePicker({ onPick }: { onPick: (row: DocRow) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DocRow[] | null>(null);

  // Fetch the doc list on mount. No "fetch-once" ref guard: under React
  // StrictMode the effect mounts→unmounts→remounts, and a ref guard would
  // let the first (cancelled) run win and leave `rows` null forever ("stuck
  // on Loading…"). The `cancelled` flag alone is the correct pattern.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/docs");
        if (!res.ok) { if (!cancelled) setRows([]); return; }
        const d = await res.json();
        const list: DocRow[] = (d.docs ?? d.data ?? d ?? []).map((r: { id: string; title: string }) => ({
          id: r.id,
          title: r.title || "Untitled note",
        }));
        if (!cancelled) setRows(list);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = (() => {
    if (rows === null) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows.slice(0, 8);
    return rows.filter((r) => r.title.toLowerCase().includes(q)).slice(0, 12);
  })();

  return (
    <div
      className="bn-subpage bn-subpage--picker"
      contentEditable={false}
      // Keep the editor from hijacking selection/keyboard while the writer
      // interacts with the picker (a custom block's UI lives inside the
      // ProseMirror doc, which otherwise captures these events).
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="bn-subpage__picker-head">
        <Search />
        <input
          type="text"
          placeholder="Search notes to link…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          autoFocus
        />
      </div>
      <div className="bn-subpage__picker-list">
        {filtered === null ? (
          <div className="bn-subpage__picker-empty">
            <Loader2 className="bn-subpage__spin" /> Loading notes…
          </div>
        ) : filtered.length === 0 ? (
          <div className="bn-subpage__picker-empty">No matches</div>
        ) : (
          filtered.map((row) => (
            <button
              key={row.id}
              type="button"
              className="bn-subpage__picker-row"
              // preventDefault on mousedown stops the editor blurring/moving
              // the selection before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(row)}
            >
              <FileText />
              <span>{row.title}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
