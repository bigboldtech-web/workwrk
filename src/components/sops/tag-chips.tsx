"use client";

import { X } from "lucide-react";

export interface TagOption {
  name: string;
  count: number;
}

interface Props {
  tags: TagOption[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClearAll?: () => void;
  /** Cap how many chips are shown by default; rest collapse behind "+N more". */
  maxVisible?: number;
}

/**
 * Horizontal chip row of org-wide tags. Click to toggle inclusion in
 * the current filter. Filtering by multiple chips intersects (an SOP
 * must have all selected tags) — matches the user mental model of
 * progressively narrowing.
 */
export function TagChips({ tags, selected, onToggle, onClearAll, maxVisible = 12 }: Props) {
  if (tags.length === 0) return null;

  const visible = tags.slice(0, maxVisible);
  const hidden = tags.length - visible.length;
  const selectedSet = new Set(selected);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visible.map((t) => {
        const on = selectedSet.has(t.name);
        return (
          <button
            key={t.name}
            type="button"
            onClick={() => onToggle(t.name)}
            className={[
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              on
                ? "border-[#d4ff2e] bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]"
                : "border-border text-muted hover:text-foreground hover:border-muted-2",
            ].join(" ")}
            aria-pressed={on}
          >
            <span>{t.name}</span>
            <span className="opacity-60 font-mono tabular-nums text-[10px]">{t.count}</span>
          </button>
        );
      })}
      {hidden > 0 && (
        <span className="text-[10px] text-muted">+{hidden} more</span>
      )}
      {selected.length > 0 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-foreground"
        >
          <X size={10} /> Clear tags
        </button>
      )}
    </div>
  );
}
