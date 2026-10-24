"use client";

// SettingsSection (settings-cleanup B3 and C4, design-system 4.2): the one
// section label on a settings page, lifted from the copies Apps & modules,
// its AI sections and Data each drew by hand. 11/600 uppercase, +0.06em,
// --os-ink-2, with a rule to the column's edge, 8px above its first card.
// Sections stack 32px apart (the page's own `gap-8`).
//
// A section label groups two or more cards under one name; it never repeats
// a card's title. `id` keeps a hash anchor on the section (#modules,
// #requests): a builder who moves a section keeps its id.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingsSectionProps {
  label: ReactNode;
  /** One 13/400 line under the label, about the whole section. */
  description?: ReactNode;
  /** Hash anchor for the section. */
  id?: string;
  children?: ReactNode;
  className?: string;
}

/** The label row's classes, exported for the section's tests. */
export const SETTINGS_SECTION_LABEL = "flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2";

export function SettingsSection({ label, description, id, children, className }: SettingsSectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-4", className)}>
      {/* Joined by hand, not through cn(): tailwind-merge reads text-micro as
          a colour and drops it beside text-ink-2, which drew a 14px label. */}
      <h2 className={`${SETTINGS_SECTION_LABEL} ${description ? "mb-1" : "mb-2"}`}>
        {label}
        <span className="h-px flex-1 bg-line" aria-hidden />
      </h2>
      {description ? <p className="mb-2 text-sm text-ink-2">{description}</p> : null}
      {children}
    </section>
  );
}
