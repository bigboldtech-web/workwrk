"use client";

// SettingsRow (spec-settings-workspace section 3, design-system 5.4): one
// autosave row. 48px minimum, label 14/500 and helper 13/400 at the left, the
// control at the right, a soft separator between rows. The row reports its
// own save state:
//
//   savedAt   a timestamp from the last successful write; "Saved" shows for
//             two seconds and fades
//   error     the last write failed; "Couldn't save" with a wired Retry
//             (the caller has already reverted the control)
//   lock      set by the workspace: the value renders as text with a Lock
//             glyph and "Set by your workspace", never a disabled control
//   readOnlyValue  read-only viewers see the value as text in the control's
//             place, so no control the viewer cannot use is ever rendered
//   enforcedAt the route that enforces the value, as a tooltip

import { useEffect, useState, type ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export const SAVED_TICK_MS = 2000;

/** Whether the "Saved" tick is still showing (pure; tested). */
export function savedTickVisible(savedAt: number | null | undefined, now: number): boolean {
  return typeof savedAt === "number" && now - savedAt >= 0 && now - savedAt < SAVED_TICK_MS;
}

export interface SettingsRowProps {
  label: ReactNode;
  helper?: ReactNode;
  control?: ReactNode;
  savedAt?: number | null;
  error?: { message?: string; onRetry: () => void } | null;
  /** Locked by the workspace: show this value as text instead of the control. */
  lock?: { value: ReactNode } | null;
  readOnlyValue?: ReactNode;
  enforcedAt?: string;
  /** Field anchor (settings registry id). */
  id?: string;
  className?: string;
}

export function SettingsRow({ label, helper, control, savedAt, error, lock, readOnlyValue, enforcedAt, id, className }: SettingsRowProps) {
  // The tick shows from the save until SAVED_TICK_MS later; the timer marks
  // that save as faded, so render never reads the clock.
  const [fadedAt, setFadedAt] = useState<number | null>(null);
  useEffect(() => {
    if (typeof savedAt !== "number") return;
    const t = window.setTimeout(() => setFadedAt(savedAt), SAVED_TICK_MS);
    return () => window.clearTimeout(t);
  }, [savedAt]);
  const showSaved = typeof savedAt === "number" && fadedAt !== savedAt && !error;

  let right: ReactNode = control;
  if (lock) {
    right = (
      <span className="inline-flex items-center gap-1.5 text-base text-ink">
        {lock.value}
        <Lock className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />
        <span className="text-sm text-ink-2">Set by your workspace</span>
      </span>
    );
  } else if (readOnlyValue !== undefined) {
    right = <span className="text-base text-ink">{readOnlyValue}</span>;
  }

  return (
    <div
      id={id}
      title={enforcedAt ? `Enforced at: ${enforcedAt}` : undefined}
      className={cn("flex min-h-12 items-center gap-4 border-b border-line-soft py-2 last:border-b-0", className)}
    >
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium text-ink">{label}</div>
        {helper ? <div className="mt-0.5 text-sm text-ink-2">{helper}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {showSaved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text" role="status">
            <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Saved
          </span>
        ) : null}
        {error ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text" role="alert">
            {error.message || "Couldn't save"}
            <button type="button" onClick={error.onRetry} className="underline underline-offset-2 hover:text-ink">
              Retry
            </button>
          </span>
        ) : null}
        {right}
      </div>
    </div>
  );
}
