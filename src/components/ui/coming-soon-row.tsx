// ComingSoonRow (spec-shell 1.15): the only way a capability whose backend
// is not wired may appear, and only when the viewer has turned on
// "Show upcoming features" (home.ui.showUpcoming). A 36px non-interactive
// line: a div, not a button, not focusable; the label 14/400 ink-3 and a
// neutral "Coming soon" chip at the right; tooltip "Not built yet". No
// handler, no toast, no disabled button. With the preference off the row is
// absent, so `useShowUpcoming` is the gate every caller reads.

"use client";

import type { LucideIcon } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

/** Whether this viewer has opted into seeing not-yet-built capabilities. */
export function useShowUpcoming(): boolean {
  const { prefs } = useOsShell();
  return prefs.home.ui?.showUpcoming === true;
}

/**
 * Renders its children only when "Show upcoming features" is on. The wrapper
 * a server component or a menu can use around a ComingSoonRow (or a tab)
 * without calling the hook itself.
 */
export function UpcomingOnly({ children }: { children: React.ReactNode }) {
  const show = useShowUpcoming();
  return show ? <>{children}</> : null;
}

export function ComingSoonRow({ label, icon: Icon, className }: { label: string; icon?: LucideIcon; className?: string }) {
  return (
    <div
      className={`os-chrome flex h-9 items-center gap-2 rounded-md px-3 text-base text-ink-3 ${className ?? ""}`}
      title="Not built yet"
      aria-label={`${label}, not built yet`}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-line bg-subtle px-1.5 text-xs font-medium text-ink-2">Coming soon</span>
    </div>
  );
}
