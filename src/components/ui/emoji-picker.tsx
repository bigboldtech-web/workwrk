"use client";

// EmojiPicker (spec-talk.md section 3): search, eight categories as 11/600
// section labels, a Recent row, 32px cells, and an EMBEDDED list rather than
// a CDN one. The data and the two pure functions live in src/lib/emoji-data.ts
// so the search ranking and the recent-list folding are tested; this file is
// the surface.
//
// It is an ABSOLUTE CHILD, never a portal, for the reason the Picker's own
// header gives: a portalled popover inside the task drawer or the New channel
// dialog escapes that dialog's focus trap and lands behind the next scrim.
// The caller therefore wraps the trigger in a `relative` box and positions
// this with `align` and `side`.
//
// It registers on the shell's layer stack, so Esc closes it before anything
// underneath, and it restores focus to the trigger on close: a popover a
// keyboard user cannot leave is the bug this replaces.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useLayer } from "@/components/layout/os/shell-context";
import {
  EMOJI_CATEGORIES,
  parseRecent,
  pushRecent,
  searchEmoji,
  type EmojiEntry,
} from "@/lib/emoji-data";
import { TALK_EMOJI_RECENT_KEY, readTalkKey } from "@/components/talk/talk-keys";

export function EmojiPicker({
  open,
  onClose,
  onPick,
  /** Which corner the panel hangs from, relative to the (relative) parent. */
  side = "top",
  align = "start",
  /** Announced by the trigger's aria-label; also the panel's accessible name. */
  label = "Pick an emoji",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  side?: "top" | "bottom";
  align?: "start" | "end";
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayer(open, { kind: "popover", close: onClose });

  // Recents are per-device ephemera (settings section 7.3), read on OPEN so a
  // pick in another tab shows up the next time this one opens. Adjusting
  // state during render on a changed prop, not in an effect: an effect here
  // would render the stale grid once and then replace it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setRecent(parseRecent(readTalkKey(TALK_EMOJI_RECENT_KEY)));
    }
  }

  // Click-away. A transparent full-screen catcher would sit above the
  // conversation and swallow the first click anywhere, so this listens
  // instead and closes on a pointer down outside the panel and its trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target && (panel.contains(target) || panel.parentElement?.contains(target))) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose]);

  const results = useMemo(() => searchEmoji(query), [query]);

  if (!open) return null;

  const pick = (emoji: string) => {
    const next = pushRecent(recent, emoji);
    setRecent(next);
    try { window.localStorage.setItem(TALK_EMOJI_RECENT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    onPick(emoji);
  };

  const cell = (entry: EmojiEntry | string, key: string) => {
    const char = typeof entry === "string" ? entry : entry.e;
    const name = typeof entry === "string" ? char : entry.k.split(" ")[0];
    return (
      <button
        key={key}
        type="button"
        title={name}
        aria-label={name}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(char)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        {char}
      </button>
    );
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={`absolute z-30 w-[296px] rounded-lg border border-line bg-raised shadow-[var(--os-shadow-pop)] ${
        side === "top" ? "bottom-full mb-1" : "top-full mt-1"
      } ${align === "start" ? "start-0" : "end-0"}`}
    >
      <div className="flex h-9 items-center gap-2 border-b border-line-soft px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="max-h-[260px] overflow-y-auto p-1.5">
        {query.trim() ? (
          results.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-sm text-ink-2">No emoji for &ldquo;{query.trim()}&rdquo;</p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {results.map((entry) => cell(entry, entry.e))}
            </div>
          )
        ) : (
          <>
            {recent.length > 0 ? (
              <section className="mb-1">
                <h3 className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-ink-3">Recent</h3>
                <div className="grid grid-cols-8 gap-0.5">
                  {recent.map((e, i) => cell(e, `recent-${e}-${i}`))}
                </div>
              </section>
            ) : null}
            {EMOJI_CATEGORIES.map((c) => (
              <section key={c.key} className="mb-1">
                <h3 className="px-1.5 pb-1 text-micro font-semibold uppercase tracking-wide text-ink-3">{c.label}</h3>
                <div className="grid grid-cols-8 gap-0.5">
                  {c.emoji.map((entry) => cell(entry, entry.e))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
