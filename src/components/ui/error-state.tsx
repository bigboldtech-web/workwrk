// ErrorState (spec-shell 1.7): the one error primitive, OsEmptyView in its
// error shape. Four dots in a row, "Couldn't load {what}", the text link
// "Try again" (always wired: the handler is required), a 12px reference id
// when there is one. Used by error.tsx, drawers, panels, popovers and any
// page body whose read failed. A failed read renders this in place; it never
// toasts and never renders an empty list.

import type { ReactNode } from "react";
import { OsEmptyView } from "@/components/layout/os/empty-view";

export interface ErrorStateProps {
  /** What failed to load, in the sentence "Couldn't load {what}". */
  what: string;
  /** Wired to the same fetch that failed. */
  onRetry: () => void;
  /** An error digest or request id. */
  reference?: string;
  /** Override the sentence (an offline read, a boundary). */
  title?: string;
  /** A second 13px line (the raw error in development, a hint). */
  hint?: string;
  /** A BackButton or anything else under the block. */
  children?: ReactNode;
  /** In-card and in-panel uses: no illustration, tighter padding. */
  compact?: boolean;
  className?: string;
}

export function ErrorState({ what, onRetry, reference, title, hint, children, compact, className }: ErrorStateProps) {
  return (
    <OsEmptyView
      variant="error"
      title={title ?? `Couldn't load ${what}`}
      hint={hint}
      reference={reference}
      action={{ label: "Try again", onClick: onRetry }}
      compact={compact}
      className={className}
    >
      {children}
    </OsEmptyView>
  );
}
