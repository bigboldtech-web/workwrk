"use client";

// SettingsCard (spec-settings-workspace section 3, design-system 5.4,
// settings-cleanup B1 and B4): the one card on every settings page.
// Bordered surface, radius 8, 24px padding (16 below 640px), 16/600 title,
// an optional 13/400 description of at most two lines (anything longer goes
// behind `more`, the Show more link), ghost actions at the right of the
// title (under it below 640px, as a row's control is), 16px between the
// header and the body.
//
// ONE WIDTH: a card always fills its page column (760 on form pages, fluid
// to 1120 on list pages), so every card on a page shares one left and one
// right edge, in every tab. There is no 560 cap and no wide exception any
// more. `danger` is the danger zone: the pale --os-danger-border and the
// title in --os-danger-text, always the last card.
//
// `id` is the hash anchor: arriving at `#id` scrolls the card into view and
// pulses its border once (150ms, a colour change only, no transform). The
// cards above it may still be loading (Apps & modules draws each AI card
// only once its answer comes, above Rail apps), so for a few seconds after
// landing the card is put back at the top each time the page's content
// changes size, until the person scrolls, clicks or types (keepInView).

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SettingsMore } from "./settings-more";

/** How long a card landed on by its hash is kept at the top while the content above it loads. */
export const KEEP_IN_VIEW_MS = 5000;
/** What the person does that hands the scroll back to them at once. */
export const KEEP_IN_VIEW_STOPS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Keeps `el` at the top of its scroller while the page's content grows or
 * shrinks around it, for KEEP_IN_VIEW_MS or until the person acts; returns
 * the stop. The first size report (made as soon as observing starts) is
 * skipped, so the landing's own smooth scroll runs untouched.
 */
function keepInView(el: HTMLElement): () => void {
  const main = el.closest("main");
  const content = main ? [...main.children] : [document.body];
  if (typeof ResizeObserver === "undefined" || content.length === 0) return () => {};
  let done = false;
  let first = true;
  const ro = new ResizeObserver(() => {
    if (first) { first = false; return; }
    if (!done && el.isConnected) el.scrollIntoView({ block: "start" });
  });
  for (const c of content) ro.observe(c);
  const stop = () => {
    if (done) return;
    done = true;
    ro.disconnect();
    window.clearTimeout(timer);
    for (const e of KEEP_IN_VIEW_STOPS) window.removeEventListener(e, stop, true);
  };
  for (const e of KEEP_IN_VIEW_STOPS) window.addEventListener(e, stop, { capture: true, passive: true });
  const timer = window.setTimeout(stop, KEEP_IN_VIEW_MS);
  return stop;
}

export interface SettingsCardProps {
  title?: string;
  description?: ReactNode;
  /** Longer help behind the Show more link, under the description. */
  more?: ReactNode;
  /** Danger zone: danger border and title. */
  danger?: boolean;
  /**
   * @deprecated Ignored: every card fills the column now (settings-cleanup
   * C3). Kept one phase so the callers that still pass it compile; it is
   * removed with them.
   */
  wide?: string;
  /** Hash anchor; owns the one-time border pulse. */
  id?: string;
  /** Ghost actions at the right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SettingsCard({ title, description, more, danger, id, actions, children, className }: SettingsCardProps) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    let stopKeeping: (() => void) | null = null;
    const check = () => {
      if (window.location.hash !== `#${id}`) return;
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      stopKeeping?.();
      stopKeeping = el ? keepInView(el) : null;
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 150);
      return () => window.clearTimeout(t);
    };
    const cleanup = check();
    window.addEventListener("hashchange", check);
    return () => {
      cleanup?.();
      stopKeeping?.();
      window.removeEventListener("hashchange", check);
    };
  }, [id]);

  return (
    <section
      id={id}
      className={cn(
        "w-full scroll-mt-4 rounded-lg border bg-raised p-6 transition-colors duration-150 max-[640px]:p-4",
        danger ? "border-[var(--os-danger-border)]" : pulse ? "border-brand" : "border-line",
        className,
      )}
    >
      {title || actions ? (
        <header className="mb-4 flex items-start gap-3 max-[640px]:flex-col max-[640px]:gap-2">
          <div className="min-w-0 flex-1 max-[640px]:w-full max-[640px]:flex-none">
            {title ? <h2 className={cn("text-lg font-semibold", danger ? "text-danger-text" : "text-ink")}>{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-ink-2">{description}</p> : null}
            {more ? <SettingsMore className="mt-1">{more}</SettingsMore> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** The 24px stack of cards on a form page. */
export function SettingsCardStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-6", className)}>{children}</div>;
}
