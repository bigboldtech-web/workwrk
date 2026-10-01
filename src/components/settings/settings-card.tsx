"use client";

// SettingsCard (spec-settings-workspace section 3, design-system 5.4): the
// one card on every settings form page. Bordered surface, radius 8, 24px
// padding, 16/600 title, optional 13/400 description, at most five fields
// with 16px between them, 560px wide. `wide` takes the whole 760px column
// and is reserved for the table-bodied and row-list cards the spec names
// (WIDE_SETTINGS_CARDS); `danger` swaps the border and the title to the
// danger tokens and is always the last card.
//
// `id` is the hash anchor: arriving at `#id` scrolls the card into view and
// pulses its border once (150ms, a colour change only, no transform).

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The cards that may pass `wide` (spec 1.7 "the one width deviation"). A
 * lint test asserts nothing else does; add a row here only with a spec line.
 */
export const WIDE_SETTINGS_CARDS = [
  "apps.rail",
  "apps.modules",
  "access.toggles",
  "access.legacy",
  "scoring.weights",
  "scoring.bands",
  "data.retention",
  "data.exports",
  "data.import",
  "security.provisioning",
  "security.activity",
  "notifications.muted",
  "identity.appearance",
  "tasks.types",
  "tasks.tags",
  "notifications.channels",
  "shortcuts.list",
  "all.index",
] as const;
export type WideSettingsCard = (typeof WIDE_SETTINGS_CARDS)[number];

export interface SettingsCardProps {
  title?: string;
  description?: ReactNode;
  /** Danger zone: danger border and title. */
  danger?: boolean;
  /** The full 760px column, for a named table or row-list card only. */
  wide?: WideSettingsCard;
  /** Hash anchor; owns the one-time border pulse. */
  id?: string;
  /** Ghost actions at the right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SettingsCard({ title, description, danger, wide, id, actions, children, className }: SettingsCardProps) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    const check = () => {
      if (window.location.hash !== `#${id}`) return;
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 150);
      return () => window.clearTimeout(t);
    };
    const cleanup = check();
    window.addEventListener("hashchange", check);
    return () => {
      cleanup?.();
      window.removeEventListener("hashchange", check);
    };
  }, [id]);

  return (
    <section
      id={id}
      data-wide={wide ?? undefined}
      className={cn(
        "scroll-mt-4 rounded-lg border bg-raised p-6 transition-colors duration-150",
        wide ? "w-full" : "w-full max-w-[560px]",
        danger ? "border-[var(--os-danger-solid)]" : pulse ? "border-brand" : "border-line",
        className,
      )}
    >
      {title || actions ? (
        <header className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {title ? <h2 className={cn("text-lg font-semibold", danger ? "text-danger-text" : "text-ink")}>{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-ink-2">{description}</p> : null}
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
