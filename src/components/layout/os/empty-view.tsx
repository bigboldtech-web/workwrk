// OsEmptyView (spec-shell 1.7, design-system 5.8): the one empty primitive,
// and through `variant="error"` the one error primitive. Quiet: a 96px
// four-dot line drawing chosen by context, one sentence 15/400 ink-2, at
// most ONE text link 14/500 brand-deep. Centred in the content area with a
// 64px top margin. The page's blue Create button in the toolbar stays the
// one primary; an empty state never adds a second blue button and never
// fills a dot.
//
// `action` is either absent or { label, onClick | href }: a bare label with
// nothing behind it is a type error, so a link can never be silently hidden
// the way the old `cta` string was (misc-apps #14, shell 3.3).
//
// Server-safe when `action.href` is used (a Link); `onClick` needs a client
// parent, as any handler does.

import Link from "next/link";
import type { ReactNode } from "react";
import { DotsArt, type DotsArrangement } from "@/components/ui/dots-art";
import { cn } from "@/lib/utils";

/** Open the AI panel from anywhere without threading useOsShell through a presentational component. */
export function askSidekick(prompt?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:os:ask-sidekick", { detail: { prompt } }));
}

/** The four contexts of design-system 5.8 and the drawing each one gets. */
export type EmptyContext = "list" | "board" | "goals" | "docs";

const ARRANGEMENT: Record<EmptyContext, DotsArrangement> = {
  list: "row",
  board: "grid",
  goals: "cluster",
  docs: "stack",
};

export type EmptyAction =
  | { label: string; onClick: () => void; href?: undefined }
  | { label: string; href: string; onClick?: undefined };

export interface OsEmptyViewProps {
  /** The one sentence ("No tasks yet", "Couldn't load tasks"). */
  title: string;
  /** Optional second line, 13/400 ink-3: guidance, never a second sentence of the same thing. */
  hint?: string;
  /** Picks the drawing. Default: list (four dots in a row). */
  context?: EmptyContext;
  /** At most one text link; the handler or href is required by the type. */
  action?: EmptyAction;
  /** The error shape: always the row drawing, "Try again" in `action`, an optional reference id. */
  variant?: "empty" | "error";
  /** 12px reference id under the sentence (an error digest). */
  reference?: string;
  /** Anything the page must place under the block (a BackButton, a dev-only message). */
  children?: ReactNode;
  /** Filtered-empty and in-card uses drop the illustration (design-system 5.8). */
  compact?: boolean;
  className?: string;
}

function ActionLink({ action }: { action: EmptyAction }) {
  const cls = "text-base font-medium text-brand-deep hover:underline underline-offset-4";
  if (action.href !== undefined) {
    return <Link href={action.href} className={cls}>{action.label}</Link>;
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  );
}

export function OsEmptyView({ title, hint, context = "list", action, variant = "empty", reference, children, compact = false, className }: OsEmptyViewProps) {
  const arrangement = variant === "error" ? "row" : ARRANGEMENT[context];
  return (
    <div
      role={variant === "error" ? "alert" : undefined}
      className={cn("os-empty os-chrome mx-auto flex max-w-md flex-col items-center px-6 text-center", compact ? "py-6" : "mt-16 pb-16", className)}
    >
      {compact ? null : <DotsArt arrangement={arrangement} className="mb-4" />}
      <p className="m-0 text-row text-ink-2">{title}</p>
      {hint ? <p className="m-0 mt-1 text-sm text-ink-3">{hint}</p> : null}
      {reference ? <p className="m-0 mt-1 text-xs text-ink-3">Reference {reference}</p> : null}
      {action ? <div className="mt-3"><ActionLink action={action} /></div> : null}
      {children ? <div className="mt-4 flex flex-col items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * The AI-preview empty state: the same quiet block with "Ask AI" as its one
 * link. Kept for the pages that open the panel with a starter prompt.
 */
export function OsAiPreviewView({ title, hint, prompt, context }: { title: string; hint?: string; prompt?: string; context?: EmptyContext }) {
  return <OsEmptyView title={title} hint={hint} context={context} action={{ label: "Ask AI", onClick: () => askSidekick(prompt) }} />;
}
