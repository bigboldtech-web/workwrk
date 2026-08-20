"use client";

// BackButton — THE back affordance for deep pages (detail views, editors,
// full-page takeovers). One rule everywhere so the team never wonders how to
// get back:
//   - When this tab has history, it behaves like the browser Back button.
//   - When it doesn't (direct link, new tab, hard refresh), it goes UP to the
//     page's natural parent instead of dead-ending.
// Icon-only by default for tight chrome; pass `label` for a text variant.

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  /** The page's natural parent (e.g. /docs, /sops, /people/roles). */
  fallbackHref: string;
  /** Optional text next to the arrow ("Back", "All SOPs"…). */
  label?: string;
  className?: string;
}

export function BackButton({ fallbackHref, label, className }: BackButtonProps) {
  const router = useRouter();
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  };
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label ?? "Back"}
      title={label ?? "Back"}
      className={
        className ??
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13.5px] font-medium text-[var(--os-ink-3)] hover:bg-[var(--os-surface-1)] hover:text-[var(--os-ink)]"
      }
    >
      <ArrowLeft className="h-4 w-4" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}
