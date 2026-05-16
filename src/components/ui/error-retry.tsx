"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** What the user was trying to do — used in the empty-state copy. */
  title?: string;
  /** Optional secondary explanation (e.g. the error message). */
  description?: string;
  /** Async retry callback. While the returned promise is pending, the
   *  button shows a loading state. Errors thrown by the callback should
   *  be surfaced via the existing toast system. */
  onRetry: () => void | Promise<void>;
  /** Whether a retry is currently in-flight. Drives the button's
   *  loading state when the parent owns its own loading flag. */
  retrying?: boolean;
}

/**
 * Standardized "couldn't load" surface for list / detail pages. Drop in
 * place of a half-rendered card when a fetch fails so the user has a
 * one-click way to try again instead of refreshing the whole page.
 */
export function ErrorRetry({
  title = "Couldn't load this section",
  description = "The request failed — could be a flaky connection or a brief server hiccup.",
  onRetry,
  retrying,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 rounded-2xl border border-dashed border-amber-400/40 bg-amber-400/5">
      <div
        className="h-12 w-12 rounded-2xl flex items-center justify-center mb-3"
        style={{
          background: "rgba(251, 191, 36, 0.12)",
          border: "1px solid rgba(251, 191, 36, 0.3)",
          color: "rgb(251, 191, 36)",
        }}
      >
        <AlertTriangle size={22} />
      </div>
      <h3 className="mb-1 text-center text-foreground" style={{ fontSize: 15, fontWeight: 600 }}>
        {title}
      </h3>
      <p className="text-center max-w-md mb-4 text-muted" style={{ fontSize: 13 }}>
        {description}
      </p>
      <Button onClick={() => { void onRetry(); }} disabled={retrying} size="sm" variant="outline" className="gap-1.5">
        <RotateCw size={12} className={retrying ? "animate-spin" : ""} />
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
