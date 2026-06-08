"use client";

/*
 * CalloutBlock — Notion-style callout for BlockNote.
 *
 * A tinted box with a leading emoji and editable inline text:
 *   props: { emoji: string, color: CalloutColor }
 *   content: "inline"   — the body text is real editable content, so the
 *                         slash menu, formatting toolbar, mentions, etc. all
 *                         work inside a callout exactly like a paragraph.
 *
 * The emoji + color are editable via a tiny inline popover anchored to the
 * emoji button — no external picker dependency, matching the curated sets
 * used elsewhere in the doc chrome.
 *
 * Round-trips natively now (schema block "callout"), so it is NOT in
 * LEGACY_CUSTOM_EMBED_KINDS — edits to its props/text persist through the
 * BN ↔ legacy-mirror boundary.
 */

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";

// Color keys map to CSS classes (.bn-callout--<key>) defined in os.css.
// Kept deliberately small — the most useful Notion callout tones.
export type CalloutColor = "gray" | "blue" | "green" | "amber" | "red" | "purple";

const COLORS: { key: CalloutColor; label: string }[] = [
  { key: "gray", label: "Gray" },
  { key: "blue", label: "Blue" },
  { key: "green", label: "Green" },
  { key: "amber", label: "Amber" },
  { key: "red", label: "Red" },
  { key: "purple", label: "Purple" },
];

// Curated emoji shortlist for callouts — the common signalling glyphs.
const EMOJIS = ["💡", "📌", "⚠️", "✅", "❌", "ℹ️", "🔥", "🎯", "📝", "🚀", "⭐", "🧠", "🔔", "💬", "🛠️", "📊"];

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      emoji: { default: "💡" as string },
      color: { default: "blue" as string },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const { emoji, color } = block.props as { emoji: string; color: string };
      const colorClass = (COLORS.find((c) => c.key === color)?.key ?? "blue") as CalloutColor;
      return (
        <div className={`bn-callout bn-callout--${colorClass}`} data-callout>
          <CalloutControl
            emoji={emoji || "💡"}
            color={colorClass}
            editable={editor.isEditable}
            onChange={(patch) => editor.updateBlock(block, { props: patch })}
          />
          {/* Editable body — BlockNote fills this with the inline content. */}
          <div className="bn-callout__body" ref={contentRef} />
        </div>
      );
    },
  },
);

// ───────── Emoji + color control ─────────

function CalloutControl({
  emoji,
  color,
  editable,
  onChange,
}: {
  emoji: string;
  color: CalloutColor;
  editable: boolean;
  onChange: (patch: { emoji?: string; color?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="bn-callout__control" ref={wrapRef} contentEditable={false}>
      <button
        type="button"
        className="bn-callout__emoji"
        onClick={() => editable && setOpen((s) => !s)}
        aria-label="Change callout icon and color"
        tabIndex={-1}
      >
        {emoji}
      </button>
      {open && (
        <div className="bn-callout__pop">
          <div className="bn-callout__pop-row bn-callout__pop-colors">
            {COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`bn-callout__swatch bn-callout__swatch--${c.key} ${color === c.key ? "is-on" : ""}`}
                onClick={() => onChange({ color: c.key })}
                title={c.label}
                aria-label={c.label}
              />
            ))}
          </div>
          <div className="bn-callout__pop-row bn-callout__pop-emojis">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className={`bn-callout__emoji-cell ${emoji === e ? "is-on" : ""}`}
                onClick={() => { onChange({ emoji: e }); setOpen(false); }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
