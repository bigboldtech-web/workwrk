"use client";

// SettingsMore (settings-cleanup B6 and C5): the "Show more" text link that
// keeps long help out of a row hint or a card description. Lifted from the
// disclosure Access already draws under its old grid ("Show the grid as it
// stood"): a 13/500 --os-brand-deep text link with aria-expanded, collapsed
// by default, that opens the full text in 13/400 --os-ink-2 in place, inside
// the same card, under what it explains. Never a tooltip and never a blue
// callout for prose.
//
// SettingsRow and SettingsCard take it as their `more` prop. A row draws the
// link and the text apart (useSettingsMore, SettingsMoreLink and
// SettingsMoreBody): the link under the helper, the opened text full width
// under the label and control line, so the control stays on its label's
// line (settings-cleanup Phase 2 review, L5).

import { useId, useState, type ReactNode } from "react";

export const SETTINGS_MORE_LABEL = "Show more";
export const SETTINGS_LESS_LABEL = "Show less";

/** One disclosure's state, shared by its link and its text wherever each is drawn. */
export interface SettingsMoreState {
  open: boolean;
  toggle: () => void;
  bodyId: string;
}

export function useSettingsMore(defaultOpen = false): SettingsMoreState {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return { open, toggle: () => setOpen((v) => !v), bodyId };
}

/**
 * The text link: Show more while closed, Show less while open. `about` is
 * what it opens more of (the row's label, the card's title), read after the
 * visible words, so a list of links is not a dozen "Show more" and the name
 * still starts with what is on screen (final Settings review, L6).
 */
export function SettingsMoreLink({ state, label = SETTINGS_MORE_LABEL, openLabel = SETTINGS_LESS_LABEL, about }: { state: SettingsMoreState; label?: string; openLabel?: string; about?: string }) {
  return (
    <button
      type="button"
      className="text-sm font-medium text-brand-deep hover:underline"
      aria-expanded={state.open}
      aria-controls={state.bodyId}
      onClick={state.toggle}
    >
      {state.open ? openLabel : label}
      {about ? <span className="sr-only"> about {about}</span> : null}
    </button>
  );
}

/** A label that can name a Show more: plain words only, never markup. */
export const moreAbout = (label: unknown): string | undefined => (typeof label === "string" && label.trim() ? label : undefined);

/** The text it opens. Always in the DOM (hidden while closed), so aria-controls names a real element. */
export function SettingsMoreBody({ state, children, className }: { state: SettingsMoreState; children: ReactNode; className?: string }) {
  return (
    <div id={state.bodyId} hidden={!state.open} className={`${className ? `${className} ` : ""}flex-col gap-2 text-sm text-ink-2 [&:not([hidden])]:flex`}>
      {children}
    </div>
  );
}

export interface SettingsMoreProps {
  /** The link while closed. */
  label?: string;
  /** What it opens more of, read after the link's words. */
  about?: string;
  /** The link while open. */
  openLabel?: string;
  /** Open on first render (only for a proof or a test; people open it). */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function SettingsMore({ label = SETTINGS_MORE_LABEL, openLabel = SETTINGS_LESS_LABEL, about, defaultOpen = false, children, className }: SettingsMoreProps) {
  const state = useSettingsMore(defaultOpen);
  return (
    <div className={className}>
      <SettingsMoreLink state={state} label={label} openLabel={openLabel} about={about} />
      <SettingsMoreBody state={state} className="mt-1">{children}</SettingsMoreBody>
    </div>
  );
}
