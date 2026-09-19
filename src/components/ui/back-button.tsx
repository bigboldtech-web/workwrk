"use client";

// BackButton: THE back control (spec-shell 1.5, back-map 0, design-system
// 5.18). A 28px ghost with ArrowLeft and the parent's name at 13/500 ink-2,
// rendered 8px before the title in the title row of every full page reached
// from a list. It uses browser back when the in-app history stack (navStack)
// has an entry, and `fallbackHref` (the page's natural parent) otherwise, so
// a direct link, a new tab or a hard refresh never dead-ends. The button is
// always rendered with a fixed fallback: the browser exposes no way to read
// the previous entry, so no route may make it conditional on where the
// person came from. `router.back()` is allowed here and nowhere else.

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { navStackHasBack } from "@/components/layout/os/top-bar/nav-history";

interface BackButtonProps {
  /** The page's natural parent (e.g. /docs, /sops, /people/roles). */
  fallbackHref: string;
  /** The parent's name ("Docs", "SOPs", "Job titles"). Icon-only when omitted. */
  label?: string;
  className?: string;
}

/**
 * The history check, on its own, for the one control that needs it without
 * being a BackButton: the task drawer's ✕ / scrim click / Esc, all three of
 * which must "call router.back() when the previous entry is the host list,
 * else router.replace(hostUrl)" (back-map section 1). Keeping it in this file
 * is what keeps the rule true, `router.back()` lives here and nowhere else, 
 * rather than spreading a second copy of the check into a drawer.
 */
export function goBackOr(
  router: { back: () => void; replace: (href: string) => void },
  fallbackHref: string,
): void {
  if (navStackHasBack()) router.back();
  else router.replace(fallbackHref);
}

export function BackButton({ fallbackHref, label, className }: BackButtonProps) {
  const router = useRouter();
  const goBack = () => {
    if (navStackHasBack()) router.back();
    else router.push(fallbackHref);
  };
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label ? `Back to ${label}` : "Back"}
      title={label ? `Back to ${label}` : "Back"}
      // .os-chrome: the 28px ghost is drawn in px (h-7 = 28, not 24.5 under
      // the 14px root) wherever it renders, in or out of the page header.
      className={cn(
        "os-chrome inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
      {label ? <span className="truncate">{label}</span> : null}
    </button>
  );
}
