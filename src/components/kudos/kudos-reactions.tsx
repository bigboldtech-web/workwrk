"use client";

import { useState, useRef, useEffect } from "react";
import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOsToast } from "@/components/layout/os/toast";

const PICKER_EMOJIS = ["🙌", "🔥", "💚", "💯", "🎯", "👏", "🪔", "❤️", "🚀", "✨", "💪", "🎉"];

export interface ReactionCount {
  emoji: string;
  count: number;
}

/** The chips and my reactions after toggling `emoji` once: what the row
 *  shows while the POST is in flight (the server's answer replaces it). */
export function toggleReaction(
  counts: readonly ReactionCount[],
  mine: readonly string[],
  emoji: string,
): { counts: ReactionCount[]; mine: string[] } {
  const hadIt = mine.includes(emoji);
  const map = new Map(counts.map((c) => [c.emoji, c.count]));
  const current = map.get(emoji) || 0;
  const next = hadIt ? current - 1 : current + 1;
  if (next <= 0) map.delete(emoji);
  else map.set(emoji, next);
  return {
    counts: Array.from(map.entries())
      .map(([e, c]) => ({ emoji: e, count: c }))
      .sort((a, b) => b.count - a.count),
    mine: hadIt ? mine.filter((m) => m !== emoji) : [...mine, emoji],
  };
}

/** Whether a Try again still has to send anything: if the person already
 *  got to the state they wanted (they clicked the chip again by hand before
 *  pressing Try again) there is nothing left to save. The request itself
 *  carries the wanted state ({ emoji, on }), so even a resend could not undo
 *  a reaction; this only spares the round trip. */
export function reactionRetryNeeded(mine: readonly string[], emoji: string, wantOn: boolean): boolean {
  return mine.includes(emoji) !== wantOn;
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
  const { toast, dismiss } = useOsToast();
  // Refs mirror the state so a Try again pressed in the toast seconds later
  // (a closure from the failed render) reads what the row shows NOW, not what
  // it showed when the save failed, and so the busy guard holds across it.
  const countsRef = useRef<ReactionCount[]>(initialCounts);
  const mineRef = useRef<string[]>(initialMine);
  const busyRef = useRef(false);
  // The save in flight, so a Try again pressed meanwhile waits for it and
  // then really sends instead of being dropped by the busy guard.
  const inflightRef = useRef<Promise<void> | null>(null);
  // One toast slot per kudos AND emoji: a 🙌 that saves must not take down
  // the failure (and its Try again) of the 🔥 that did not.
  const toastKeyFor = (emoji: string) => `kudos-react-${kudosId}-${emoji}`;

  const show = (nextCounts: ReactionCount[], nextMine: string[]) => {
    countsRef.current = nextCounts;
    mineRef.current = nextMine;
    setCounts(nextCounts);
    setMine(nextMine);
  };

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

  // `wantOn` is only passed by Try again: it is the intent of the reaction
  // that failed (add or remove), so a retry repeats that intent rather than
  // toggling whatever the row happens to show by then.
  const react = async (emoji: string, wantOn?: boolean) => {
    // A click on a chip or the picker is disabled while a save runs, so a
    // busy click is only a double click landing before the re-render. A Try
    // again is different: the person asked for it, so it waits its turn.
    if (wantOn === undefined && busyRef.current) return;
    while (busyRef.current) await (inflightRef.current ?? Promise.resolve());
    const toastKey = toastKeyFor(emoji);
    const hadIt = mineRef.current.includes(emoji);
    const intent = wantOn ?? !hadIt;
    if (!reactionRetryNeeded(mineRef.current, emoji, intent)) {
      dismiss(toastKey);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    let settle: () => void = () => {};
    inflightRef.current = new Promise<void>((resolve) => { settle = resolve; });

    // Optimistic update
    const prevCounts = countsRef.current;
    const prevMine = mineRef.current;
    const optimistic = toggleReaction(prevCounts, prevMine, emoji);
    show(optimistic.counts, optimistic.mine);

    // Only the server's own words go under the toast; a dropped connection
    // ("Failed to fetch") says nothing the headline does not.
    let reason: string | undefined;
    try {
      const res = await fetch(`/api/kudos/${kudosId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The wanted state, not a toggle: a resend of a save that landed
        // but answered with an error keeps the reaction instead of undoing it.
        body: JSON.stringify({ emoji, on: intent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (typeof body?.error === "string" && body.error.trim()) reason = body.error.trim();
        throw new Error("react failed");
      }
      const json = await res.json();
      show(
        Array.isArray(json.byEmoji) ? json.byEmoji : optimistic.counts,
        Array.isArray(json.myReactions) ? json.myReactions : optimistic.mine,
      );
      // A reaction that failed and then landed on Try again must not keep
      // saying it failed.
      dismiss(toastKey);
    } catch {
      // Rollback on failure, and say so: a reaction that quietly vanishes
      // looks like the product ignored the click.
      show(prevCounts, prevMine);
      toast(intent ? `Couldn't add your ${emoji} reaction` : `Couldn't remove your ${emoji} reaction`, {
        tone: "danger",
        key: toastKey,
        description: reason,
        action: { label: "Try again", onClick: () => void react(emoji, intent) },
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPickerOpen(false);
      settle();
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
                ? "border-[var(--os-brand)] bg-brand-soft text-ink"
                : "border-line bg-raised text-ink-2 hover:bg-hover hover:text-ink",
              busy && "opacity-60 cursor-not-allowed",
            )}
            aria-pressed={active}
            aria-label={`React ${c.emoji} (${c.count})`}
          >
            <span className="text-xs leading-none">{c.emoji}</span>
            <span className="font-mono text-xs">{c.count}</span>
          </button>
        );
      })}

      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink",
            busy && "opacity-60 cursor-not-allowed",
          )}
          aria-label="Add reaction"
        >
          <SmilePlus size={12} />
          {totalReactions === 0 && !compact && <span>React</span>}
        </button>
        {pickerOpen && (
          <div
            className="absolute bottom-full start-0 mb-2 z-[60] w-[16rem] rounded-lg border border-line bg-raised p-2 shadow-[var(--os-shadow-pop)]"
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
                    "h-9 w-9 flex items-center justify-center rounded-md text-lg leading-none transition-colors hover:bg-hover",
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
        <span className="text-xs text-ink-2 ml-auto">
          {totalReactions} reaction{totalReactions === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
