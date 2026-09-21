"use client";

// ReadOnlyBanner (spec-docs-knowledge section 3, access-model 5.4): the 44px
// strip under the title row of an object page the viewer can only read.
//
//   "View only. Ask {owner} for edit access."   [Request]
//
// The verb is a text link, never a disabled toolbar: a control the role
// cannot use is absent, and this one line is what stands in its place. The
// Request link posts an access request when the object supports it and
// otherwise opens the "Who has access" door the caller passes.

import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export function ReadOnlyBanner({
  ownerName,
  onRequest,
  requestLabel = "Request",
  message,
  variant = "strip",
  className,
}: {
  /** The object's owner, for "Ask {owner} for edit access." */
  ownerName?: string | null;
  /** The Request link. Omit to render the sentence alone. */
  onRequest?: () => void;
  requestLabel?: string;
  /** Overrides the sentence ("Locked by Priya. Ask them to unlock."). */
  message?: string;
  /**
   * "strip" = the 44px full-bleed strip under a doc's title row (spec-docs
   * section 3). "inline" = the process unit's 36px --os-surface-1 strip with
   * a 1px line and radius 6 INSIDE the 720 column (spec-process section 1).
   */
  variant?: "strip" | "inline";
  className?: string;
}) {
  const who = ownerName?.trim() || "the owner";
  return (
    <div
      role="status"
      className={cn(
        "os-chrome flex items-center gap-3 bg-subtle text-ink",
        variant === "inline" ? "h-9 rounded-md border border-line px-3 text-sm text-ink-2" : "min-h-11 border-b border-line px-6 text-base",
        className,
      )}
    >
      <Eye className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{message ?? `View only. Ask ${who} for edit access.`}</span>
      {onRequest ? (
        <button type="button" onClick={onRequest} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
          {requestLabel}
        </button>
      ) : null}
    </div>
  );
}
