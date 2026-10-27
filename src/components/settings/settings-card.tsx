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
// landing scroll is smooth, or instant for anyone who asked for less motion
// (their system's setting, or My settings > Preferences > Reduced motion,
// which sets html[data-reduced-motion="reduce"]). The cards above it may
// still be loading (Apps & modules draws each AI card only once its answer
// comes, so AI apps (MCP) is pushed down by the two above it, and every card
// under Modules by its tiles), so for a few seconds after landing the card
// is put back at the top each time the page's content changes size, until
// the person scrolls, touches, clicks, types or drags the scrollbar, or the
// hash stops naming the card (keepInView, landOnHash).

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SettingsMoreBody, SettingsMoreLink, useSettingsMore } from "./settings-more";
import { STACKED_GHOST_ALIGN, hasDetail } from "./settings-row";

/** How long a card landed on by its hash is kept at the top while the content above it loads. */
export const KEEP_IN_VIEW_MS = 5000;
/** What the person does anywhere on the page that hands the scroll back to them at once. */
export const KEEP_IN_VIEW_STOPS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
/** A press on the scroller itself, its scrollbar's too: a scrollbar drag hands the scroll back as well. */
export const KEEP_IN_VIEW_SCROLLER_STOPS = ["pointerdown"] as const;

/** Whether the person asked for less motion: their system's setting, or My settings' Reduced motion. */
export function reducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement?.getAttribute("data-reduced-motion") === "reduce") return true;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The element that scrolls `el`: its nearest ancestor that scrolls, else the page. */
function scrollerOf(el: HTMLElement): EventTarget | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = window.getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll" || o === "overlay") return p;
  }
  return document.scrollingElement ?? document.documentElement ?? null;
}

/**
 * Keeps `el` at the top of its scroller while the page's content grows or
 * shrinks around it, for KEEP_IN_VIEW_MS or until the person acts, or the
 * hash no longer names `el`; returns the stop. The first size report (made
 * as soon as observing starts) is skipped, so the landing's own scroll runs
 * untouched. Every listener and the timer go with the stop.
 */
export function keepInView(el: HTMLElement): () => void {
  const main = el.closest("main");
  const content = main ? [...main.children] : [document.body];
  if (typeof ResizeObserver === "undefined" || content.length === 0) return () => {};
  const scroller = scrollerOf(el);
  let done = false;
  let first = true;
  const ro = new ResizeObserver(() => {
    if (first) { first = false; return; }
    if (done) return;
    // A link to another card, or the hash cleared: this card's hold is over.
    if (window.location.hash !== `#${el.id}`) { stop(); return; }
    if (el.isConnected) el.scrollIntoView({ block: "start" });
  });
  for (const c of content) ro.observe(c);
  const stop = () => {
    if (done) return;
    done = true;
    ro.disconnect();
    window.clearTimeout(timer);
    for (const e of KEEP_IN_VIEW_STOPS) window.removeEventListener(e, stop, true);
    for (const e of KEEP_IN_VIEW_SCROLLER_STOPS) scroller?.removeEventListener(e, stop);
  };
  for (const e of KEEP_IN_VIEW_STOPS) window.addEventListener(e, stop, { capture: true, passive: true });
  for (const e of KEEP_IN_VIEW_SCROLLER_STOPS) scroller?.addEventListener(e, stop, { passive: true });
  const timer = window.setTimeout(stop, KEEP_IN_VIEW_MS);
  return stop;
}

/**
 * A card's hash landing, the effect SettingsCard runs for its `id`: at
 * `#id`, now or at a later hashchange, the card scrolls into view, pulses
 * once (`pulse(true)`, then `pulse(false)` 150ms later) and is kept there
 * (keepInView); a hashchange that no longer names the card ends its hold.
 * Returns the effect's cleanup, which ends the hold, the pulse's timer and
 * the hashchange listener.
 */
export function landOnHash(id: string, pulse: (on: boolean) => void): () => void {
  let stopKeeping: (() => void) | null = null;
  let pulseTimer: number | undefined;
  const check = () => {
    if (window.location.hash !== `#${id}`) {
      stopKeeping?.();
      stopKeeping = null;
      return;
    }
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    stopKeeping?.();
    stopKeeping = el ? keepInView(el) : null;
    pulse(true);
    window.clearTimeout(pulseTimer);
    pulseTimer = window.setTimeout(() => pulse(false), 150);
  };
  check();
  window.addEventListener("hashchange", check);
  return () => {
    window.clearTimeout(pulseTimer);
    stopKeeping?.();
    stopKeeping = null;
    window.removeEventListener("hashchange", check);
  };
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
  const hasBody = hasDetail(children);
  const moreState = useSettingsMore();

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    return landOnHash(id, setPulse);
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
        // 16px to the body; a card that is only its title, description and
        // Show more (Access > How access works) has no body and no gap, so
        // its bottom padding matches its top (settings-cleanup Phase 5).
        //
        // Show more: the link under the description, and the text it opens
        // on its own line under the title and the actions, full width, as a
        // row's opened text sits under its label and control (settings-
        // cleanup Phase 5 review, L5): beside a card action it was squeezed
        // into the title's column. The header wraps for it only.
        <header className={cn(hasBody && "mb-4", "flex items-start gap-3 max-[640px]:flex-col max-[640px]:gap-2", more ? "flex-wrap gap-y-0" : "")}>
          <div className="min-w-0 flex-1 max-[640px]:w-full max-[640px]:flex-none">
            {title ? <h2 className={cn("text-lg font-semibold", danger ? "text-danger-text" : "text-ink")}>{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-ink-2">{description}</p> : null}
            {more ? <div className="mt-1"><SettingsMoreLink state={moreState} /></div> : null}
          </div>
          {/* Under the title below 640px, a ghost action pulls back by its own
              padding so its words start on the title's edge, as a stacked
              row's control does (STACKED_GHOST_ALIGN; settings-cleanup Phase 4). */}
          {actions ? <div className={cn("flex shrink-0 items-center gap-1", STACKED_GHOST_ALIGN)}>{actions}</div> : null}
          {more ? <SettingsMoreBody state={moreState} className="mt-1 w-full">{more}</SettingsMoreBody> : null}
        </header>
      ) : null}
      {hasBody ? <div className="flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}

/** The 24px stack of cards on a form page. */
export function SettingsCardStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-6", className)}>{children}</div>;
}
