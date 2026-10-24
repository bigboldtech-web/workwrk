"use client";

// SettingsMore (settings-cleanup B6 and C5): the "Show more" text link that
// keeps long help out of a row hint or a card description. Lifted from the
// disclosure Access already draws under its old grid ("Show the grid as it
// stood"): a 13/500 --os-brand-deep text link with aria-expanded, collapsed
// by default, that opens the full text in 13/400 --os-ink-2 in place, inside
// the same card, under what it explains. Never a tooltip and never a blue
// callout for prose.
//
// SettingsRow and SettingsCard take it as their `more` prop.

import { useId, useState, type ReactNode } from "react";

export const SETTINGS_MORE_LABEL = "Show more";
export const SETTINGS_LESS_LABEL = "Show less";

export interface SettingsMoreProps {
  /** The link while closed. */
  label?: string;
  /** The link while open. */
  openLabel?: string;
  /** Open on first render (only for a proof or a test; people open it). */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function SettingsMore({ label = SETTINGS_MORE_LABEL, openLabel = SETTINGS_LESS_LABEL, defaultOpen = false, children, className }: SettingsMoreProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        className="text-sm font-medium text-brand-deep hover:underline"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? openLabel : label}
      </button>
      {/* Always in the DOM (hidden while closed), so aria-controls names a real element. */}
      <div id={bodyId} hidden={!open} className="mt-1 flex-col gap-2 text-sm text-ink-2 [&:not([hidden])]:flex">
        {children}
      </div>
    </div>
  );
}
