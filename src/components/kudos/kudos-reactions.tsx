"use client";

import { useState, useRef, useEffect } from "react";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";

const PICKER_EMOJIS = ["🙌", "🔥", "💚", "💯", "🎯", "👏", "🪔", "❤️", "🚀", "✨", "💪", "🎉"];

export interface ReactionCount {
  emoji: string;
  count: number;
}

export function KudosReactions({
  kudosId,
  initialCounts,
  initialMine,
  compact = false,
}: {
  kudosId: string;
  initialCounts: ReactionCount[];
  initialMine: string[];
  compact?: boolean;
}) {
  const [counts, setCounts] = useState<ReactionCount[]>(initialCounts);
  const [mine, setMine] = useState<string[]>(initialMine);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const react = async (emoji: string) => {
    if (busy) return;
    setBusy(true);

    // Optimistic update
    const hadIt = mine.includes(emoji);
    const prevCounts = counts;
    const prevMine = mine;
    const nextCounts = (() => {
      const map = new Map(counts.map((c) => [c.emoji, c.count]));
      const current = map.get(emoji) || 0;
      const next = hadIt ? current - 1 : current + 1;
      if (next <= 0) map.delete(emoji);
      else map.set(emoji, next);
      return Array.from(map.entries())
        .map(([e, c]) => ({ emoji: e, count: c }))
        .sort((a, b) => b.count - a.count);
    })();
    setCounts(nextCounts);
    setMine(hadIt ? mine.filter((m) => m !== emoji) : [...mine, emoji]);

    try {
      const res = await fetch(`/api/kudos/${kudosId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (Array.isArray(json.byEmoji)) setCounts(json.byEmoji);
      if (Array.isArray(json.myReactions)) setMine(json.myReactions);
    } catch {
      // Rollback on failure
      setCounts(prevCounts);
      setMine(prevMine);
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  };

  const totalReactions = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", compact && "gap-1.5")}>
      {counts.map((c) => {
        const active = mine.includes(c.emoji);
        return (
          <button
            key={c.emoji}
            type="button"
            onClick={() => react(c.emoji)}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
              active
                ? "border-[#d4ff2e] bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]"
                : "border-border bg-surface-2 text-foreground hover:bg-surface-3",
              busy && "opacity-60 cursor-not-allowed",
            )}
            aria-pressed={active}
            aria-label={`React ${c.emoji} (${c.count})`}
          >
            <span className="text-sm leading-none">{c.emoji}</span>
            <span className="font-mono text-[11px]">{c.count}</span>
          </button>
        );
      })}

      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted transition-colors hover:bg-surface-3 hover:text-foreground",
            busy && "opacity-60 cursor-not-allowed",
          )}
          aria-label="Add reaction"
        >
          <SmilePlus size={12} />
          {totalReactions === 0 && !compact && <span>React</span>}
        </button>
        {pickerOpen && (
          <div
            className="absolute bottom-full right-0 mb-2 z-[60] w-[16rem] rounded-lg border border-border bg-background p-2 shadow-xl"
            role="dialog"
            aria-label="Pick a reaction"
          >
            <div className="grid grid-cols-6 gap-1">
              {PICKER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => react(e)}
                  disabled={busy}
                  className={cn(
                    "h-9 w-9 flex items-center justify-center rounded-md text-[18px] leading-none transition-colors hover:bg-surface-2",
                    mine.includes(e) && "bg-[rgba(212,255,46,0.12)]",
                  )}
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {totalReactions > 0 && !compact && (
        <span className="text-[11px] text-muted ml-auto">
          {totalReactions} reaction{totalReactions === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
