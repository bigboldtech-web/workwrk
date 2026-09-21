"use client";

// ConflictStrip (spec-docs-knowledge section 3): the 44px --os-warning-bg
// strip an editor shows after a 409 from its save. Never silent, never a
// modal: the typed text is protected by the local draft (useLocalDraft), so
// the person reads the line and chooses.
//
//   "Someone else saved this doc. Reload to see their version; your changes
//    are kept as a draft."  [Reload]  [Dismiss]
//
// Used by the doc editor, the canvas editor, and offered to Tables.

import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConflictStrip({
  noun = "doc",
  onReload,
  onDismiss,
  className,
}: {
  /** "doc", "canvas", "table". */
  noun?: string;
  onReload: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "os-chrome flex min-h-11 items-center gap-3 border-b border-line bg-warning-bg px-4 text-base text-ink",
        className,
      )}
    >
      <CircleAlert className="h-4 w-4 shrink-0 text-warning-text" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1">
        Someone else saved this {noun}. Reload to see their version; your changes are kept as a draft.
      </span>
      <button type="button" onClick={onReload} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
        Reload
      </button>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-sm font-medium text-ink-2 hover:text-ink">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
