"use client";

// SettingsRow (spec-settings-workspace section 3, design-system 5.4,
// settings-cleanup B5 and B11): one autosave row. 48px minimum, label 14/500
// and a one-line helper 13/400 at the left, the control at the right, a soft
// separator between rows. Below 640px the row stacks: the label and helper
// on top, the control under them, left aligned, so a narrow phone never
// squeezes the label into a sliver beside its control. Help longer than one
// line goes behind `more`: the Show more link under the helper, and the text
// it opens full width UNDER the label and control line, so the control stays
// on its label's line instead of centring on the opened paragraph (B6;
// settings-cleanup Phase 2 review, L5). `children` are detail lines that
// belong to the row and are always shown (a connected app's dates and its
// changes, a skill's deletion date): drawn in the same place, full width
// under the line, 13/400 --os-ink-2 (settings-cleanup Phase 3); a row whose
// children render nothing (an empty list) draws no empty block. `helperId`
// puts an id on the helper, so the control can say aria-describedby it and
// a switch is read with what it does. Below 640px, where the control sits
// under the label, a ghost button control (no border, 12px of padding)
// pulls back by its padding so its text lines up with the label (Phase 3
// review, L1, L3 and L7); from 641px a ghost that ends the control pulls
// forward by the same padding, so its words end on the card's edge like
// every bordered control's (final Settings review, M1). A row whose control
// is one Switch keeps it at the right on a phone too, as the Apps rail rows
// do: only a wide control stacks under its label (`inline`, final review,
// L1). The last row of a list has no bottom padding, so a card is not
// heavier under its last row than over its first (final review, L12). The
// row reports its own save state:
//
//   savedAt   a timestamp from the last successful write; "Saved" shows for
//             two seconds and fades
//   error     the last write failed; "Couldn't save" with a wired Retry
//             (the caller has already reverted the control)
//   lock      set by the workspace: the value renders as text with a Lock
//             glyph and "Set by your workspace", never a disabled control
//   readOnlyValue  read-only viewers see the value as text in the control's
//             place, so no control the viewer cannot use is ever rendered
//   enforcedAt the route that enforces the value, as a tooltip

import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SettingsMoreBody, SettingsMoreLink, useSettingsMore } from "./settings-more";

export const SAVED_TICK_MS = 2000;

/** Whether the "Saved" tick is still showing (pure; tested). */
export function savedTickVisible(savedAt: number | null | undefined, now: number): boolean {
  return typeof savedAt === "number" && now - savedAt >= 0 && now - savedAt < SAVED_TICK_MS;
}

export interface SettingsRowProps {
  label: ReactNode;
  helper?: ReactNode;
  /** An id for the helper, for the control's aria-describedby. */
  helperId?: string;
  /** Longer help behind the Show more link, under the helper. */
  more?: ReactNode;
  control?: ReactNode;
  savedAt?: number | null;
  error?: { message?: string; onRetry: () => void } | null;
  /** Locked by the workspace: show this value as text instead of the control. */
  lock?: { value: ReactNode } | null;
  readOnlyValue?: ReactNode;
  enforcedAt?: string;
  /** Field anchor (settings registry id). */
  id?: string;
  /**
   * Keep the control beside the label below 640px too, instead of under it.
   * Default: true when the control is one Switch (inlineControl), the narrow
   * control a phone has room for.
   */
  inline?: boolean;
  className?: string;
  /** Detail lines that belong to the row, always shown, full width under the label and control line. */
  children?: ReactNode;
}

/**
 * A marker on the two borderless buttons (account-ui's btn.ghost and
 * btn.dangerGhost), with no style of its own: the row finds a ghost control
 * by it.
 */
export const GHOST_MARK = "os-btn-ghost";

/**
 * Below 640px the row stacks and its control sits under the label: a ghost
 * button there (one carrying GHOST_MARK) pulls back by its own padding, so
 * its text starts on the label's edge (settings-cleanup Phase 3 review, L7).
 * Written out whole, never built from GHOST_MARK: Tailwind only makes the
 * classes it finds spelled out in the source.
 */
export const STACKED_GHOST_ALIGN = "max-[640px]:[&>.os-btn-ghost:first-child]:-ms-3";

/**
 * From 641px, where the control sits at the row's right (and a card's
 * actions at its title's right), a ghost button that ends the slot pulls
 * forward by its own 12px padding, so its words end on the card's content
 * edge, where a bordered control's border does (final Settings review, M1:
 * Rename, Remove and Log out everywhere stopped 12px short). Written out
 * whole, as STACKED_GHOST_ALIGN is.
 */
export const GHOST_END_ALIGN = "min-[641px]:[&>.os-btn-ghost:last-child]:-me-3";

/** A row's control slot: both ghost pulls, the phone's and the desktop's. */
export const CONTROL_GHOST_ALIGN = `${STACKED_GHOST_ALIGN} ${GHOST_END_ALIGN}`;

/**
 * Whether a row's control is narrow enough to stay beside its label on a
 * phone (pure; tested): one Switch is (36px, the Apps rail rows' look);
 * anything else, a segmented control, a picker, a button or a group, stacks
 * under the label (final Settings review, L1).
 */
export function inlineControl(control: ReactNode): boolean {
  return isValidElement(control) && control.type === Switch;
}

/** Whether `children` would draw anything: an empty list, null and false draw nothing (Phase 3 review, L1). */
export function hasDetail(children: ReactNode): boolean {
  return Children.toArray(children).length > 0;
}

export function SettingsRow({ label, helper, helperId, more, control, savedAt, error, lock, readOnlyValue, enforcedAt, id, inline, className, children }: SettingsRowProps) {
  // The tick shows from the save until SAVED_TICK_MS later; the timer marks
  // that save as faded, so render never reads the clock.
  const [fadedAt, setFadedAt] = useState<number | null>(null);
  useEffect(() => {
    if (typeof savedAt !== "number") return;
    const t = window.setTimeout(() => setFadedAt(savedAt), SAVED_TICK_MS);
    return () => window.clearTimeout(t);
  }, [savedAt]);
  const showSaved = typeof savedAt === "number" && fadedAt !== savedAt && !error;
  const moreState = useSettingsMore();

  let right: ReactNode = control;
  if (lock) {
    right = (
      <span className="inline-flex items-center gap-1.5 text-base text-ink">
        {lock.value}
        <Lock className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />
        <span className="text-sm text-ink-2">Set by your workspace</span>
      </span>
    );
  } else if (readOnlyValue !== undefined) {
    right = <span className="text-base text-ink">{readOnlyValue}</span>;
  }
  // Only the switch itself keeps its place: a lock or a read-only value in
  // its place is words, which stack as any other wide control does.
  const stays = inline ?? (right === control && inlineControl(control));

  return (
    <div
      id={id}
      data-settings-row=""
      title={enforcedAt ? `Enforced at: ${enforcedAt}` : undefined}
      className={cn("flex min-h-12 flex-col justify-center border-b border-line-soft py-2 last:border-b-0 last:pb-0", className)}
    >
      {/* The label and control line: the control centres on the label, its
          helper and the Show more link, never on the opened text below. */}
      <div className={cn("flex items-center gap-4", !stays && "max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-2")}>
        <div className={cn("min-w-0 flex-1", !stays && "max-[640px]:w-full max-[640px]:flex-none")}>
          <div className="text-base font-medium text-ink">{label}</div>
          {helper ? <div id={helperId} className="mt-0.5 text-sm text-ink-2">{helper}</div> : null}
          {more ? <div className="mt-0.5"><SettingsMoreLink state={moreState} /></div> : null}
        </div>
        <div className={cn("flex shrink-0 items-center gap-3 max-[640px]:max-w-full max-[640px]:flex-wrap", CONTROL_GHOST_ALIGN)}>
          {showSaved ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text" role="status">
              <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Saved
            </span>
          ) : null}
          {error ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text" role="alert">
              {error.message || "Couldn't save"}
              <button type="button" onClick={error.onRetry} className="underline underline-offset-2 hover:text-ink">
                Retry
              </button>
            </span>
          ) : null}
          {right}
        </div>
      </div>
      {more ? <SettingsMoreBody state={moreState} className="mt-1">{more}</SettingsMoreBody> : null}
      {hasDetail(children) ? <div className="mt-1 flex flex-col gap-1 text-sm text-ink-2">{children}</div> : null}
    </div>
  );
}
