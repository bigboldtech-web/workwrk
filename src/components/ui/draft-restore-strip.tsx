"use client";

// The restore strip of useLocalDraft: "You have unsaved changes from {time}.
// Restore · Discard". A 44px --os-surface-1 strip with two text links; it
// renders only while a newer-than-server draft is pending.

import { FileClock } from "lucide-react";
import type { LocalDraft } from "@/hooks/use-local-draft";
import { useFormat } from "@/lib/format/use-date-prefs";
import { cn } from "@/lib/utils";

export function DraftRestoreStrip<T>({ draft, onRestore, className }: {
  draft: LocalDraft<T>;
  onRestore: (payload: T) => void;
  className?: string;
}) {
  const fmt = useFormat();
  if (!draft.pending) return null;
  const env = draft.pending;
  return (
    <div role="status" className={cn("os-chrome flex min-h-11 items-center gap-3 border-b border-line bg-subtle px-4 text-base text-ink", className)}>
      <FileClock className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1">
        You have unsaved changes from <span title={fmt.title(env.at)}>{fmt.date(env.at)}</span>.
      </span>
      <button type="button" onClick={() => { onRestore(env.payload); draft.consume(); }} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
        Restore
      </button>
      <button type="button" onClick={draft.discard} className="shrink-0 text-sm font-medium text-ink-2 hover:text-ink">
        Discard
      </button>
    </div>
  );
}
