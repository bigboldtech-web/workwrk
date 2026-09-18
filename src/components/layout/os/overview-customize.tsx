"use client";

// OverviewCustomizeBanner + OverviewToolbar — Overview-tab chrome. The
// banner is dismissible (sessionStorage so it doesn't pop back every
// reload). The toolbar carries the one control that works: "+ Card", the
// page's single blue primary. The Refresh readout, the auto-refresh pill and
// the Filter / Settings icon buttons were inert placeholders and are gone
// rather than left on screen (no control without a handler); they come back
// with customize-cards persistence, wired.

import { useSyncExternalStore } from "react";
import { Lightbulb, X, Plus } from "lucide-react";

const DISMISS_KEY = "workwrk:overview:customize-dismissed";

// sessionStorage read as an external store rather than through a mount effect:
// the server snapshot is "dismissed", so the markup matches on hydration and
// the banner never flashes, and dismissing it is a store write plus a
// notification instead of setState inside an effect.
const listeners = new Set<() => void>();
function subscribeDismissed(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
// Set when storage is unavailable (a private window, blocked site data), so
// Dismiss still dismisses for the rest of the session.
let dismissedInMemory = false;
function readDismissed(): boolean {
  if (dismissedInMemory) return true;
  try { return window.sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}
function dismissBanner() {
  dismissedInMemory = true;
  try { window.sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
  for (const cb of listeners) cb();
}

export function OverviewCustomizeBanner() {
  const hidden = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);

  if (hidden) return null;

  return (
    // Neutral, not a brand wash: blue never lands on the frame, a banner or
    // an icon at rest, and the page's "+ Card" button is its one primary.
    // The "Get Started" link is gone rather than inert - it had no handler
    // and no destination, and the sentence says what to do without it.
    <div className="flex items-center gap-3 rounded-md border border-line bg-subtle px-3 py-2 text-base text-ink">
      <Lightbulb className="w-3.5 h-3.5 shrink-0 text-ink-3" />
      <span className="flex-1">
        Get the most out of your Overview: add, reorder, and resize cards to customize this page.
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismissBanner}
        className="p-0.5 rounded hover:bg-hover shrink-0 text-ink-3"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function OverviewToolbar() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("workwrk:overview-add-card"));
          }
        }}
        className="inline-flex items-center gap-1 rounded bg-brand px-2.5 py-1 text-sm text-white hover:bg-brand-hover"
        title="Add a card"
      >
        <Plus className="w-3.5 h-3.5" />
        Card
      </button>
    </div>
  );
}

