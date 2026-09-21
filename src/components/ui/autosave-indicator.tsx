"use client";

// AutosaveIndicator (design-system 5.17, the data-integrity contract).
//
// Mounted in the header of every autosaving surface: a 6px `saving` dot plus
// a 12/500 ink-2 word.
//
//   idle     no dot; the idle label (default: nothing)
//   dirty    no dot; "Unsaved changes"
//   saving   dot --os-brand, opacity pulse; "Saving…"
//   saved    dot --os-success-solid; "Saved"; fades after 2s
//   error    dot --os-danger-solid, no pulse; "Not saved, retrying" in
//            --os-danger-text, stays until saved. With `onRetry` (the retry
//            budget is gone) the word is "Not saved" and a "Retry" text link
//            follows. Failure is never silent and never only colour.
//
// The props are the ones every existing caller passes (status, lastSavedAt,
// labels, className); `onRetry` is new. The hook that drives it is
// src/hooks/use-autosave.ts; the doc and canvas editors drive it from their
// own save paths as pure observers.

import { useEffect, useState } from "react";
import type { AutosaveStatus } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import { autosaveDisplay } from "@/lib/autosave-display";

interface Props {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  labels?: {
    saving?: string;
    saved?: string;
    error?: string;
    dirty?: string;
    idle?: string;
  };
  /** The retry budget is exhausted: the word becomes "Not saved" and a Retry link follows. */
  onRetry?: () => void;
  className?: string;
}

export function AutosaveIndicator({ status, lastSavedAt, labels, onRetry, className }: Props) {
  // "Saved" fades after 2s (the dot and word go quiet; nothing else changes).
  // The fade is keyed to the save it belongs to: a new lastSavedAt shows the
  // word again, and the only setState is inside the timer, never the effect.
  const savedKey = status === "saved" ? (lastSavedAt?.getTime() ?? 0) : -1;
  const [fadedKey, setFadedKey] = useState<number>(-1);
  useEffect(() => {
    if (savedKey < 0) return;
    const t = setTimeout(() => setFadedKey(savedKey), 2000);
    return () => clearTimeout(t);
  }, [savedKey]);
  const savedVisible = savedKey >= 0 && fadedKey !== savedKey;

  // The decision is pure and lives in src/lib/autosave-display.ts, where
  // every state has a test. This component only draws it.
  const d = autosaveDisplay(status, { hasRetry: !!onRetry, savedVisible, labels });
  if (d.blank) return <span className={cn("os-chrome inline-flex h-7 items-center", className)} aria-live="polite" />;
  const { dot, text } = d;
  const tone = d.danger ? "text-danger-text" : "text-ink-2";

  return (
    <span className={cn("os-chrome inline-flex h-7 items-center gap-1.5 text-xs font-medium", tone, className)} aria-live="polite" role="status">
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            dot === "brand" ? "bg-brand os-saving-pulse" : dot === "success" ? "bg-success-solid" : "bg-danger-solid",
          )}
        />
      ) : null}
      {text ? <span>{text}</span> : null}
      {d.retry && onRetry ? (
        <button type="button" onClick={onRetry} className="text-xs font-medium text-brand-deep hover:underline">
          Retry
        </button>
      ) : null}
    </span>
  );
}
